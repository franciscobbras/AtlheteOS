-- Per-UTC-day index of the intraday series, for the wearable_raw inspector's
-- "interday" section: one row per day with the count of each series present.
-- Counts are cheap aggregates today; if heart_rate grows large this can become a
-- materialized view refreshed on ingest.
--
-- UTC day (not local, not wake-day): HR is 24/7 so the calendar day is the natural
-- bucket; a sleep night's hrv/spo2 that straddles midnight shows on both UTC days,
-- which is correct for a raw view (the double-click reveals the real timestamps).

create or replace view wearable.intraday_day_index
with (security_invoker = true) as
select
  day,
  sum(hr)   as hr,
  sum(hrv)  as hrv,
  sum(spo2) as spo2
from (
  select (timestamp_utc at time zone 'UTC')::date as day, count(*) as hr, 0 as hrv, 0 as spo2
    from wearable.heart_rate group by 1
  union all
  select (timestamp_utc at time zone 'UTC')::date, 0, count(*), 0
    from wearable.hrv_instant group by 1
  union all
  select (timestamp_utc at time zone 'UTC')::date, 0, 0, count(*)
    from wearable.spo2 group by 1
) t
group by day;

grant select on wearable.intraday_day_index to authenticated, service_role;
