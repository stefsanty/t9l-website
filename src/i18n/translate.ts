import { Anthropic } from '@anthropic-ai/sdk';
import { Redis } from '@upstash/redis';
import { cache } from 'react';
import { en, MessageKey } from './en';
import { Locale } from './getLocale';

const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function translateDictImpl(
  dict: typeof en,
  locale: Locale
): Promise<Record<MessageKey, string>> {
  if (locale === 'en') return dict;

  const keys = Object.keys(dict) as MessageKey[];
  const cacheKeys = keys.map((key) => `t9l:i18n:${locale}:${key}`);

  try {
    // 1. Batch-read Redis
    const cachedValues = await redis.mget<string[]>(cacheKeys);
    const result = { ...dict } as Record<MessageKey, string>;
    const missingKeys: MessageKey[] = [];

    cachedValues.forEach((val, i) => {
      if (val) {
        result[keys[i]] = val;
      } else {
        missingKeys.push(keys[i]);
      }
    });

    // 2. If no missing keys, return merged result
    if (missingKeys.length === 0) {
      return result;
    }

    // 3. Fallback if API key is missing
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('ANTHROPIC_API_KEY is missing, falling back to English');
      return result;
    }

    // 4. Batch call Claude
    const missingDict: Record<string, string> = {};
    missingKeys.forEach((k) => {
      missingDict[k] = dict[k];
    });

    const prompt = `You are translating UI strings for a Tokyo recreational football league webapp from English to natural, concise Japanese suitable for a mobile app. Keep it short — these are UI labels, not prose. Return strict JSON mapping each key to its translation. Input: ${JSON.stringify(
      missingDict
    )}`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022', // Using a known stable model instead of speculative future one
      max_tokens: 4096,
      system: "Return only valid JSON. Do not include any other text.",
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const translated = JSON.parse(content.text) as Record<MessageKey, string>;
      
      // 5. Write back to Redis and merge into result
      const pipeline = redis.pipeline();
      for (const key of missingKeys) {
        if (translated[key]) {
          result[key] = translated[key];
          pipeline.set(`t9l:i18n:${locale}:${key}`, translated[key]);
        }
      }
      await pipeline.exec();
    }

    return result;
  } catch (error) {
    console.error('Translation error:', error);
    return dict; // Graceful degradation
  }
}

export const translateDict = cache(translateDictImpl);
