import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_FILE = './driver_portal.sqlite';

let dbInstance = null;

// Database initialization function
async function initializeDatabase() {
  try {
    const db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database
    });

    console.log('Connected to the SQLite database.');

    // Create tables if they don't exist
    await db.exec(`CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );`);

    await db.exec(`CREATE TABLE IF NOT EXISTS check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      check_in_time TEXT NOT NULL,
      sign_out_time TEXT,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
      UNIQUE(driver_id, date)
    );`);
    // Added ON DELETE CASCADE for driver_id FK
    // Added UNIQUE constraint for driver_id and date on check_ins

    await db.exec(`CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_in_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      call_type TEXT, /* Added to store 'Account', 'Police' etc. */
      FOREIGN KEY (check_in_id) REFERENCES check_ins(id) ON DELETE CASCADE
    );`);
    // Added call_type to calls table
    // Added ON DELETE CASCADE for check_in_id FK

    await db.exec(`CREATE TABLE IF NOT EXISTS call_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL, /* Changed from check_in_id and call_timestamp */
      status TEXT NOT NULL, /* 'cleared', 'cancelled' */
      status_timestamp TEXT NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
      UNIQUE(call_id) /* A call can only have one final status */
    );`);
    // Refactored call_status to link directly to calls.id for simplicity
    // and to ensure a call can only have one status record.

    await db.exec(`CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      total_drivers INTEGER,
      total_calls INTEGER,
      total_canceled_calls INTEGER
    );`);
    // Added UNIQUE constraint for date on shifts

    console.log('Database tables verified/created.');
    return db;
  } catch (err) {
    console.error('Error initializing database:', err.message);
    throw err; // Re-throw error to be caught by caller
  }
}

// Function to get the database instance
// It initializes the DB on first call and then returns the instance
async function getDb() {
  if (!dbInstance) {
    dbInstance = await initializeDatabase();
  }
  return dbInstance;
}

// Export a function that allows server.js to get the db instance
// and handle errors during initial connection.
// This is a bit different from just exporting getDb directly to allow
// server.js to know about the initial connection attempt.
export default {
  get: async (callback) => {
    try {
      const db = await getDb();
      callback(null, db);
    } catch (err) {
      callback(err, null);
    }
  },
  // Expose direct getDb for other modules if they need to ensure DB is ready
  getInstance: getDb,
  DB_FILE // Export DB_FILE path
};
