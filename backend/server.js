import express from 'express';
import cors from 'cors';
import dbModule from './database.js'; // Renamed import

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// Basic route
app.get('/', (req, res) => {
  res.send('Driver Check-In Portal Backend is running!');
});

// TODO: Add API routes here later

// API Routes

/**
 * @route POST /api/drivers
 * @description Adds a new driver to the database.
 * @param {object} req.body - The request body.
 * @param {string} req.body.name - The name of the driver.
 * @returns {object} 201 - The newly created driver object with id, name, and a success message.
 * @returns {object} 400 - If the driver name is missing.
 * @returns {object} 409 - If the driver name already exists (violates UNIQUE constraint).
 * @returns {object} 500 - If there's a server error.
 */
app.post('/api/drivers', async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Driver name is required.' });
  }

  try {
    const db = await dbModule.getInstance();
    // Use a unique ID similar to client-side (milliseconds timestamp)
    // SQLite's AUTOINCREMENT is fine for 'id' but the original app used timestamp-based IDs for drivers
    // For simplicity and consistency with potential future direct ID references from an unmodified frontend,
    // we'll generate an ID here. The `id` column in `drivers` is still PRIMARY KEY.
    const driverId = Date.now();

    const result = await db.run(
      'INSERT INTO drivers (id, name) VALUES (?, ?)',
      [driverId, name.trim()]
    );

    // The result object for db.run in 'sqlite' package for an INSERT
    // typically has lastID and changes. lastID is the ROWID of the inserted row.
    // We're using our own driverId, so we'll return that.
    res.status(201).json({ id: driverId, name: name.trim(), message: 'Driver added successfully.' });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE constraint failed: drivers.name')) {
      return res.status(409).json({ error: 'Driver name must be unique.' });
    }
    console.error('Error adding driver:', error);
    res.status(500).json({ error: 'Failed to add driver to the database.' });
  }
});

// POST /api/shifts/end - End the current shift, calculate stats, and save to shifts table
app.post('/api/shifts/end', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[End Shift API] Received request for date: ${today}`);

  try {
    const db = await dbModule.getInstance();
    let totalDrivers = 0;
    let totalCalls = 0;
    let totalCancelledCalls = 0;

    // Get all check-ins for today
    const checkInsToday = await db.all('SELECT id, driver_id FROM check_ins WHERE date = ?', [today]);
    console.log(`[End Shift API] Found ${checkInsToday.length} check-ins for today.`);

    if (checkInsToday.length > 0) {
      const driverIdsToday = new Set(checkInsToday.map(ci => ci.driver_id));
      totalDrivers = driverIdsToday.size;
      console.log(`[End Shift API] Unique drivers today: ${totalDrivers}`);

      for (const ci of checkInsToday) {
        // Count total calls for this check-in
        const callsResult = await db.get('SELECT COUNT(*) AS count FROM calls WHERE check_in_id = ?', [ci.id]);
        if (callsResult && callsResult.count > 0) {
          totalCalls += callsResult.count;
          console.log(`[End Shift API] CheckIn ID ${ci.id}: Found ${callsResult.count} calls. Running totalCalls: ${totalCalls}`);

          // Count cancelled calls for this check-in
          // This requires joining calls and call_status
          const cancelledCallsResult = await db.get(
            `SELECT COUNT(*) AS count
             FROM calls c
             JOIN call_status cs ON c.id = cs.call_id
             WHERE c.check_in_id = ? AND cs.status = 'cancelled'`,
            [ci.id]
          );
          if (cancelledCallsResult && cancelledCallsResult.count > 0) {
            totalCancelledCalls += cancelledCallsResult.count;
            console.log(`[End Shift API] CheckIn ID ${ci.id}: Found ${cancelledCallsResult.count} cancelled calls. Running totalCancelledCalls: ${totalCancelledCalls}`);
          }
        }
      }
    }

    console.log(`[End Shift API] Final stats for ${today}: Drivers=${totalDrivers}, Calls=${totalCalls}, Cancelled=${totalCancelledCalls}`);

    // Upsert into shifts table
    await db.run(
      `INSERT INTO shifts (date, total_drivers, total_calls, total_canceled_calls)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         total_drivers = excluded.total_drivers,
         total_calls = excluded.total_calls,
         total_canceled_calls = excluded.total_canceled_calls`,
      [today, totalDrivers, totalCalls, totalCancelledCalls]
    );
    console.log(`[End Shift API] Shift data for ${today} saved/updated.`);

    res.json({
      message: 'Shift ended successfully. Summary saved.',
      date: today,
      totalDrivers,
      totalCalls,
      totalCancelledCalls
    });

  } catch (error) {
    console.error('[End Shift API] Error ending shift:', error);
    res.status(500).json({ error: 'Failed to end shift and save summary.' });
  }
});

// PUT /api/calls/status - Update the status of a call
app.put('/api/calls/status', async (req, res) => {
  const { driverId, callTimestamp: fullCallTimestamp, status } = req.body;

  if (!driverId || !fullCallTimestamp || !status) {
    return res.status(400).json({ error: 'Driver ID, Call Timestamp, and Status are required.' });
  }

  if (status !== 'cleared' && status !== 'cancelled') {
    return res.status(400).json({ error: "Invalid status. Must be 'cleared' or 'cancelled'." });
  }

  // Extract call type prefix and actual time from fullCallTimestamp
  // Original format e.g., "Acc 12:34:56" or "Call 12:34:56"
  let callTypeFromPrefix;
  let actualCallTime;
  const parts = fullCallTimestamp.split(/ (.*)/s); // Split only on the first space
  if (parts.length > 1 && parts[1]) {
    callTypeFromPrefix = parts[0]; // e.g., "Acc", "Pol"
    actualCallTime = parts[1];   // e.g., "12:34:56"
  } else {
    // If no space, maybe it's just a time? Or an un-prefixed call from old data?
    // This case needs clarification if such data exists or if format is strict.
    // For now, assume it must have a prefix and time.
    // Or, if only time is passed, the call_type search criteria would be problematic.
    // Let's assume client sends the prefixed one as per original logic.
     return res.status(400).json({ error: 'Call Timestamp must be in "Type HH:MM:SS" format.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const statusTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  try {
    const db = await dbModule.getInstance();

    // 1. Get the check_in_id for the driver for today
    const checkIn = await db.get(
      'SELECT id FROM check_ins WHERE driver_id = ? AND date = ? AND sign_out_time IS NULL',
      [driverId, today]
    );
    if (!checkIn) {
      return res.status(404).json({ error: 'Driver is not actively checked in for today.' });
    }
    const checkInId = checkIn.id;

    // 2. Find the call_id using check_in_id, actualCallTime, and potentially callTypeFromPrefix
    // The calls.call_type stores the full type e.g. "Account", "Police".
    // The client's context menu for addCall uses "Account", "Police", etc.
    // The client's addCall function creates a prefix like "Acc", "Pol".
    // This means callTypeFromPrefix needs to be mapped or calls.call_type needs to be like "Acc".
    // For now, let's assume calls.call_type stores the full name, and we'll search by timestamp primarily.
    // If multiple calls have the exact same timestamp for the same check-in (unlikely but possible), this could be ambiguous.
    // A more robust way would be for the client to send call_id.
    // Given the current plan, we use callTimestamp.

    // Let's find the call based on check_in_id and the exact timestamp.
    // The call_type in the calls table is the full type like "Account", "Police".
    // The prefix in fullCallTimestamp is like "Acc".
    // This makes matching by callTypeFromPrefix tricky without a mapping.
    // For now, we will find the call primarily by its timestamp for that check-in.
    const call = await db.get(
      'SELECT id FROM calls WHERE check_in_id = ? AND timestamp = ?',
      [checkInId, actualCallTime]
    );

    if (!call) {
      return res.status(404).json({ error: `Call at ${actualCallTime} not found for this driver's active session.` });
    }
    const callId = call.id;

    // 3. Insert or update call_status
    // UNIQUE constraint on call_status(call_id) means we can use INSERT OR REPLACE or an UPSERT pattern.
    // Using INSERT ... ON CONFLICT ... DO UPDATE for SQLite
    await db.run(
      `INSERT INTO call_status (call_id, status, status_timestamp)
       VALUES (?, ?, ?)
       ON CONFLICT(call_id) DO UPDATE SET
         status = excluded.status,
         status_timestamp = excluded.status_timestamp`,
      [callId, status, statusTimestamp]
    );

    res.json({ message: `Call status updated to ${status}.`, callId, status, statusTimestamp });

  } catch (error) {
    console.error('Error updating call status:', error);
    res.status(500).json({ error: 'Failed to update call status.' });
  }
});

// POST /api/calls - Add a new call for a driver
app.post('/api/calls', async (req, res) => {
  const { driverId, callType } = req.body;

  if (!driverId || !callType) {
    return res.status(400).json({ error: 'Driver ID and Call Type are required.' });
  }
  if (typeof callType !== 'string' || callType.trim() === '') {
    return res.status(400).json({ error: 'Call Type must be a non-empty string.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const callTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  try {
    const db = await dbModule.getInstance();

    // First, get the current check_in_id for the driver for today
    const checkIn = await db.get(
      'SELECT id FROM check_ins WHERE driver_id = ? AND date = ? AND sign_out_time IS NULL',
      [driverId, today]
    );

    if (!checkIn) {
      return res.status(404).json({ error: 'Driver is not checked in or already signed out for today.' });
    }

    const checkInId = checkIn.id;

    // Insert the call
    const result = await db.run(
      'INSERT INTO calls (check_in_id, timestamp, call_type) VALUES (?, ?, ?)',
      [checkInId, callTimestamp, callType.trim()]
    );

    const newCallId = result.lastID; // Get the ID of the newly inserted call

    res.status(201).json({
      id: newCallId,
      checkInId,
      timestamp: callTimestamp,
      callType: callType.trim(),
      message: 'Call added successfully.'
    });

  } catch (error) {
    // FOREIGN KEY constraint failure on check_in_id would be caught by the checkIn query above,
    // but good to be aware of if that logic changed.
    console.error('Error adding call:', error);
    res.status(500).json({ error: 'Failed to add call.' });
  }
});

// POST /api/signout - Sign out a driver
app.post('/api/signout', async (req, res) => {
  const { driverId } = req.body;

  if (!driverId) {
    return res.status(400).json({ error: 'Driver ID is required for sign-out.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const signOutTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  try {
    const db = await dbModule.getInstance();
    const result = await db.run(
      'UPDATE check_ins SET sign_out_time = ? WHERE driver_id = ? AND date = ? AND sign_out_time IS NULL',
      [signOutTime, driverId, today]
    );

    if (result.changes === 0) {
      // This could be because the driver wasn't checked in, or was already signed out.
      // Check if the record exists to give a more specific message.
      const existingCheckIn = await db.get(
        'SELECT id, sign_out_time FROM check_ins WHERE driver_id = ? AND date = ?',
        [driverId, today]
      );
      if (!existingCheckIn) {
        return res.status(404).json({ error: 'Driver not checked in today.' });
      } else if (existingCheckIn.sign_out_time) {
        return res.status(409).json({ error: 'Driver already signed out today.' });
      }
      // If changes still 0 but conditions above not met, something else is wrong, though unlikely here.
      return res.status(400).json({ error: 'Sign out failed. Driver may not be checked in or already signed out.' });
    }

    res.json({ message: 'Driver signed out successfully.', driverId, date: today, signOutTime });
  } catch (error) {
    console.error('Error signing out driver:', error);
    res.status(500).json({ error: 'Failed to sign out driver.' });
  }
});

/**
 * @route POST /api/checkin
 * @description Checks in a driver for the current day.
 * @param {object} req.body - The request body.
 * @param {number} req.body.driverId - The ID of the driver to check in.
 * @returns {object} 201 - Success message with check-in details.
 * @returns {object} 400 - If driverId is missing.
 * @returns {object} 404 - If the driver is not found (FOREIGN KEY constraint).
 * @returns {object} 409 - If the driver is already checked in today (UNIQUE constraint).
 * @returns {object} 500 - If there's a server error.
 */
app.post('/api/checkin', async (req, res) => {
  const { driverId } = req.body; // Assuming frontend sends driverId

  if (!driverId) {
    return res.status(400).json({ error: 'Driver ID is required for check-in.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const checkInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  try {
    const db = await dbModule.getInstance();

    // Optional: Check if driver exists, though FOREIGN KEY constraint would also catch this
    // const driver = await db.get('SELECT id FROM drivers WHERE id = ?', driverId);
    // if (!driver) {
    //   return res.status(404).json({ error: 'Driver not found.' });
    // }

    await db.run(
      'INSERT INTO check_ins (driver_id, date, check_in_time) VALUES (?, ?, ?)',
      [driverId, today, checkInTime]
    );
    res.status(201).json({ message: 'Driver checked in successfully.', driverId, date: today, checkInTime });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE constraint failed: check_ins.driver_id, check_ins.date')) {
      return res.status(409).json({ error: 'Driver already checked in today.' });
    }
    if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
      return res.status(404).json({ error: 'Driver not found or invalid Driver ID.' });
    }
    console.error('Error checking in driver:', error);
    res.status(500).json({ error: 'Failed to check in driver.' });
  }
});

/**
 * @route GET /api/drivers
 * @description Fetches all drivers along with their detailed status for the current day,
 *              including check-in/out times, calls, and call statuses.
 * @returns {Array<object>} 200 - An array of driver objects with detailed information.
 * @returns {object} 500 - If there's a server error.
 */
app.get('/api/drivers', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[API GET /api/drivers] Request for date: ${today}`);

  try {
    const db = await dbModule.getInstance();
    const driversList = await db.all('SELECT id, name FROM drivers ORDER BY name COLLATE NOCASE');

    const driversData = [];

    for (const driver of driversList) {
      const driverData = {
        id: driver.id,
        name: driver.name,
        isCheckedIn: false,
        checkInTime: null,
        signOutTime: null,
        calls: [],
        relevantClearedTimestamp: null,
      };

      // Get today's check-in for this driver
      const checkIn = await db.get(
        'SELECT id, check_in_time, sign_out_time FROM check_ins WHERE driver_id = ? AND date = ?',
        [driver.id, today]
      );

      if (checkIn) {
        driverData.checkInTime = checkIn.check_in_time;
        driverData.signOutTime = checkIn.sign_out_time;

        // Driver is considered active if checked in today AND not yet signed out
        driverData.isCheckedIn = !checkIn.sign_out_time;

        // Get calls for this check-in
        const callsForCheckIn = await db.all(
          'SELECT id, call_type, timestamp FROM calls WHERE check_in_id = ? ORDER BY timestamp',
          [checkIn.id]
        );

        let latestClearedTimestampForDriver = null;

        for (const call of callsForCheckIn) {
          const callStatus = await db.get(
            'SELECT status, status_timestamp FROM call_status WHERE call_id = ?',
            [call.id]
          );

          // Reconstruct fullCallTimestamp for UI consistency
          const typePrefix = call.call_type.length > 3 ? call.call_type.substring(0, 3) : call.call_type;
          const fullCallTimestamp = `${typePrefix} ${call.timestamp}`;

          driverData.calls.push({
            id: call.id,
            callType: call.call_type,
            timestamp: call.timestamp,
            fullCallTimestamp: fullCallTimestamp,
            statusInfo: callStatus ? { status: callStatus.status, statusTimestamp: callStatus.status_timestamp } : null,
          });

          if (callStatus && callStatus.status === 'cleared' && callStatus.status_timestamp) {
            if (!latestClearedTimestampForDriver || callStatus.status_timestamp > latestClearedTimestampForDriver) {
              latestClearedTimestampForDriver = callStatus.status_timestamp;
            }
          }
        }
        driverData.relevantClearedTimestamp = latestClearedTimestampForDriver;
      }
      driversData.push(driverData);
    }

    res.json(driversData);

  } catch (error) {
    console.error('Error fetching detailed drivers data:', error);
    res.status(500).json({ error: 'Failed to fetch detailed drivers data.' });
  }
});

// GET /api/export/sqlite - Export the SQLite database file
app.get('/api/export/sqlite', (req, res) => {
  const dbFilePath = dbModule.DB_FILE; // Access the DB_FILE path from database.js (needs to be exported)
  if (!dbFilePath) { // Should not happen if dbModule is structured as expected
      console.error("Database file path not configured in database.js");
      return res.status(500).json({ error: "Database file path configuration error." });
  }
  res.download(dbFilePath, `driver_portal_db_${new Date().toISOString().split('T')[0]}.sqlite`, (err) => {
    if (err) {
      console.error('Error exporting SQLite DB:', err);
      // Avoid sending another response if headers already sent, though res.download should handle this.
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to export SQLite database.' });
      }
    } else {
      console.log('SQLite DB exported.');
    }
  });
});

// GET /api/export/csv - Export data to CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const db = await dbModule.getInstance();
    const query = `
      SELECT
        ci.date,
        d.name AS driver_name,
        ci.check_in_time,
        ci.sign_out_time,
        c.call_type,             -- Separate call_type field
        c.timestamp AS call_time, -- Just the time part
        cs.status AS call_status,
        cs.status_timestamp
      FROM drivers d
      JOIN check_ins ci ON d.id = ci.driver_id
      LEFT JOIN calls c ON ci.id = c.check_in_id
      LEFT JOIN call_status cs ON c.id = cs.call_id
      ORDER BY ci.date DESC, d.name, ci.check_in_time, c.timestamp;
    `;
    const rows = await db.all(query);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data available to export to CSV.' });
    }

    let csvContent = "Date,Driver Name,Check-In Time,Sign-Out Time,Call Timestamp,Call Type,Status,Status Timestamp\n";

    const escapeCSV = (field) => {
        if (field === null || typeof field === 'undefined') return '';
        let str = String(field);
        str = str.replace(/"/g, '""'); // Escape double quotes
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            str = '"' + str + '"'; // Enclose in double quotes if it contains comma, newline, or double quote
        }
        return str;
    };

    rows.forEach(row => {
      // Reconstruct the "Type HH:MM:SS" format for Call Timestamp if call_type and call_time exist
      let callTimestampWithPrefix = "";
      if (row.call_type && row.call_time) {
        // Create a short prefix (e.g., first 3 chars of call_type, or "Call" if shorter)
        const typePrefix = row.call_type.length > 3 ? row.call_type.substring(0, 3) : row.call_type;
        callTimestampWithPrefix = `${typePrefix} ${row.call_time}`;
      } else if (row.call_time) { // If only time exists (no type)
        callTimestampWithPrefix = row.call_time;
      }

      csvContent += [
        escapeCSV(row.date),
        escapeCSV(row.driver_name),
        escapeCSV(row.check_in_time),
        escapeCSV(row.sign_out_time || ""),
        escapeCSV(callTimestampWithPrefix), // The reconstructed timestamp with prefix
        escapeCSV(row.call_type || ""),     // The full call type
        escapeCSV(row.call_status || ""),
        escapeCSV(row.status_timestamp || "")
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="driver_portal_data_${new Date().toISOString().split('T')[0]}.csv"`);
    res.status(200).send(csvContent);
    console.log('CSV data exported.');

  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export data to CSV.' });
  }
});


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  // Initialize database connection
  dbModule.get((err, connection) => {
    if (err) {
      console.error('Failed to connect to the database on startup.', err);
    } else {
      console.log('Successfully connected to the database.');
      // Ensure tables are created if they don't exist
      // (The table creation logic will be in database.js)
    }
  });
});
