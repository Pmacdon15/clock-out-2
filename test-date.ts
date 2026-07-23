import { fromZonedTime } from 'date-fns-tz';

const tz = 'America/New_York';
console.log('Plain date:', fromZonedTime('2026-07-23', tz).toISOString());
console.log('Date with time:', fromZonedTime('2026-07-23T23:59:59.999', tz).toISOString());
