import { google } from "googleapis";
import { getMockData } from "./mock-data";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function parsePrivateKey(): string {
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
  privateKey = privateKey.replace(/^["']|["']$/g, "");
  privateKey = privateKey.replace(/\\n/g, "\n");
  return privateKey;
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: parsePrivateKey(),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getWriteAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key: parsePrivateKey(),
    },
    // Full spreadsheets scope allows both read and write
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
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

/**
 * Write a player's availability (Y or blank) for a matchday into RosterRaw.
 * Requires the Google service account to have Editor access on the sheet.
 */
export async function writeRosterAvailability(
  playerId: string,
  matchdayId: string,
  going: boolean,
): Promise<void> {
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error("Google Sheets not configured");
  }

  const auth = getWriteAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Fetch only the player name column to find the row
  const rosterRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "RosterRaw!B:B",
  });

  const nameRows = (rosterRes.data.values as string[][]) || [];

  function localSlugify(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Row 0 is the header; find from row 1 onward
  const rowIndex = nameRows.findIndex(
    (row, i) => i > 0 && localSlugify(row[0] ?? "") === playerId,
  );

  if (rowIndex === -1) {
    throw new Error(`Player "${playerId}" not found in RosterRaw`);
  }

  // Column mapping: MD1=E(5th col), MD2=F, …, MD8=L
  const mdNum = parseInt(matchdayId.replace(/[^0-9]/g, ""), 10);
  if (isNaN(mdNum) || mdNum < 1 || mdNum > 8) {
    throw new Error(`Invalid matchdayId: ${matchdayId}`);
  }

  // A=65, so MD1 col E = 65+4=69 = 'E', MD2='F', …
  const colLetter = String.fromCharCode(64 + 4 + mdNum); // E=5th letter
  const sheetRowNumber = rowIndex + 1; // 1-indexed (header is row 1)

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `RosterRaw!${colLetter}${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[going ? "Y" : ""]] },
  });
}
