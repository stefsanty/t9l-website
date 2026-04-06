import { google } from "googleapis";
import { getMockData } from "./mock-data";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export interface RawSheetData {
  teams: string[][];
  roster: string[][];
  schedule: string[][];
  goals: string[][];
  ratings: string[][];
  scheduleFormula: string[][];
  mdSchedule: string[][];
}

export async function fetchSheetData(): Promise<RawSheetData> {
  // Use mock data when Google Sheets credentials are not configured
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return getMockData();
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: [
      "TeamRaw!A:B",
      "RosterRaw!A:L",
      "ScheduleRaw!A:F",
      "GoalsRaw!A:F",
      "RatingsRaw!A:BH",
      "Schedule Formula!A:E",
      "MDScheduleRaw!A:B",
    ],
  });

  const ranges = response.data.valueRanges || [];

  return {
    teams: (ranges[0]?.values as string[][]) || [],
    roster: (ranges[1]?.values as string[][]) || [],
    schedule: (ranges[2]?.values as string[][]) || [],
    goals: (ranges[3]?.values as string[][]) || [],
    ratings: (ranges[4]?.values as string[][]) || [],
    scheduleFormula: (ranges[5]?.values as string[][]) || [],
    mdSchedule: (ranges[6]?.values as string[][]) || [],
  };
}
