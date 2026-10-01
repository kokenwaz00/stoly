# Server Time API for STOLY

## Overview

The STOLY project now includes a server-side time synchronization system to ensure accurate countdown timers for table openings. This prevents issues where users see inconsistent times based on their local browser clock.

## How It Works

### Problem Solved
- ❌ **Before:** Timer showed 24 hours on every page refresh (relied on `Date.now()` in browser)
- ❌ Users with wrong system time saw incorrect countdown
- ❌ Each browser session reset the timer

### Solution
- ✅ **Now:** Timer syncs with server time (Moscow timezone)
- ✅ Countdown is consistent across all browsers and sessions
- ✅ Immune to local system clock issues
- ✅ Survives page refreshes and cache clears

## Architecture

### Server Component (`server.js`)

```javascript
// Handles:
- Static file serving (HTML, CSS, JS)
- API endpoint: GET /api/server-time
```

**API Response:**
```json
{
  "serverTimeMs": 1696172400000,
  "serverTimeUtc": "2026-10-01T17:40:00.000Z",
  "serverTimeMsk": "01.10.2026, 20:40:00",
  "table2OpenAtMs": 1696259400000,
  "table2OpenDelayMs": 86400000,
  "timezone": "Europe/Moscow"
}
```

### Frontend Component (`js/app.js`)

**Key Variables:**
- `serverTimeOffset` — difference between server and browser time (in ms)
- `TABLE_2_OPEN_TIME_MS` — milliseconds when table 2 opens (from server)
- `getServerTimeNowMs()` — returns current server time as perceived by browser

**Initialization Flow:**
1. On page load, fetch `/api/server-time`
2. Calculate `serverTimeOffset = serverTimeMs - Date.now()`
3. Store `TABLE_2_OPEN_TIME_MS` from server response
4. Use `getServerTimeNowMs()` instead of `Date.now()` for timer calculations

**Timer Update (every 1 second):**
```javascript
const remaining = TABLE_2_OPEN_TIME_MS - getServerTimeNowMs();
timerEl.textContent = formatCountdown(remaining);
```

## Running the Server

### Development

```bash
npm install
npm run dev
# Server starts on http://localhost:5173
```

The server will:
- Serve static files from the root directory
- Provide time sync API at `/api/server-time`
- Auto-calculate table 2 opening time (24 hours after server start)

### Production

```bash
PORT=3000 node server.js
```

## Environment Variables

Create a `.env` file (optional):

```env
PORT=5173
NODE_ENV=production
TIMEZONE=Europe/Moscow
```

## Technical Details

### Time Offset Calculation

The offset is calculated once on page load to account for network latency:

```javascript
// Browser receives: serverTimeMs
// Browser has: Date.now()
// Calculate: offset = serverTimeMs - Date.now()
// Use: getServerTimeNowMs() = Date.now() + offset
```

**Advantages:**
- Simple one-time calculation
- Accounts for latency automatically
- No need for NTP or other complex protocols

### Timezone Handling

- Server generates times in **Europe/Moscow** timezone (UTC+3 or UTC+4)
- Response includes both UTC and MSK timestamps for debugging
- Browser displays times using user's local timezone (formatted via `toLocaleString`)

### Cache Control

The server sets HTTP headers to prevent caching:
```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
```

This ensures fresh time data on every page load.

## Fallback Behavior

If the server time API fails:
- `TABLE_2_OPEN_TIME_MS` falls back to 24 hours from `Date.now()`
- Timer still works, but less reliably
- Console logs the error for debugging

```javascript
catch (err) {
  console.error('Failed to sync server time:', err);
  // Fallback: use 24 hours from now
  TABLE_2_OPEN_TIME_MS = Date.now() + 24 * 60 * 60 * 1000;
}
```

## API Endpoints

### GET `/api/server-time`

**Purpose:** Get current server time and table 2 opening time

**Response:**
```json
{
  "serverTimeMs": 1696172400000,
  "serverTimeUtc": "2026-10-01T17:40:00.000Z",
  "serverTimeMsk": "01.10.2026, 20:40:00",
  "table2OpenAtMs": 1696259400000,
  "table2OpenDelayMs": 86400000,
  "timezone": "Europe/Moscow"
}
```

**Status Codes:**
- `200` — Success
- `500` — Server error (rarely occurs)

## Testing

### 1. Basic Test
```bash
curl http://localhost:5173/api/server-time
```

Should return current timestamp.

### 2. Time Sync Test
```javascript
// In browser console:
fetch('/api/server-time')
  .then(r => r.json())
  .then(data => {
    console.log('Server time:', new Date(data.serverTimeMs));
    console.log('Browser time:', new Date());
    console.log('Offset:', data.serverTimeMs - Date.now(), 'ms');
  });
```

### 3. Timer Test
1. Open the app
2. Check console for: `Server time synced. Offset: X ms`
3. Navigate to tables view (stol 2 countdown)
4. Refresh page multiple times
5. Timer should remain consistent (not reset to 24:00:00)

## Deployment Considerations

### On Vercel/Netlify (Serverless)
- Each invocation gets a fresh time offset
- Works fine but may have slight jitter between requests
- Consider edge functions for better consistency

### On Traditional Server (Recommended)
- Single process ensures consistent time
- Server restart resets table 2 opening time
- No additional complexity

### On Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
EXPOSE 5173
CMD ["node", "server.js"]
```

## Troubleshooting

### Timer shows "Открыт" immediately
- Table 2 opening time is in the past
- Check server logs: `table2OpenAtMs` should be future timestamp
- Restart server: opening time is recalculated

### Timer not updating
- Check browser console for errors
- Verify `/api/server-time` returns valid JSON
- Check network tab: should see successful `GET /api/server-time`

### Different time on different browsers
- Normal: each browser calculates its own offset
- Timer values should still match (within 1 second)
- If times diverge significantly, check client/server clocks

### CORS Issues
- Server allows all origins (no CORS headers set)
- If behind proxy (nginx), ensure proxy passes headers correctly

## Future Improvements

1. **Persistent Table 2 Opening Time**
   - Store in database/file
   - Survives server restarts
   - Allow admin to set custom opening times

2. **Multiple Timezones**
   - Support different target timezones
   - Return times in multiple formats

3. **Real-time Server Status**
   - Add `/api/status` endpoint
   - Return table states, player counts, etc.

4. **WebSocket Support**
   - Push time updates to clients
   - Reduce polling frequency

## Security Notes

- API is read-only, no authentication needed
- Timestamp is public information
- No sensitive data exposed
- Server doesn't track individual users

---

**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  
**Version:** 1.0.0
