import { fromZonedTime } from "date-fns-tz";

const tz = "America/New_York";
const date = fromZonedTime("2023-10-25", tz);
console.log(date.toISOString());
