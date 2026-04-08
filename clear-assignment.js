const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: 'https://main-pigeon-70519.upstash.io',
  token: 'gQAAAAAAARN3AAIncDJjZjc2ZWFmMGU0YWU0ZTJmYTVmNjEzMjg1YzVjYTFkMXAyNzA1MTk',
});

redis.hgetall('line-player-map').then(map => {
  console.log('Current mappings:', JSON.stringify(map, null, 2));
  return redis.del('line-player-map');
}).then(() => {
  console.log('Cleared.');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
