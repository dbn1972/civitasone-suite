# LGD Data Import — Instructions

## Source
Download from: https://lgdirectory.gov.in or GitHub mirror:
- States: https://github.com/planemad/india-local-government-directory/tree/master/data
- Districts: Same repo, `districts.csv`
- Blocks: Same repo, `blocks.csv`

## Schema Mapping

| LGD Field | DB Column | Table |
|-----------|-----------|-------|
| State Code | lgd_code (custom field needed) | location.locations (type='state') |
| State Name | name | location.locations |
| District Code | lgd_code | location.locations (type='district') |
| District Name | name | location.locations |
| Block Code | lgd_code | location.locations (type='block') |
| Block Name | name | location.locations |
| Parent relationship | parent_id → state/district UUID | location.locations |

## Import Command
```bash
# 1. Download CSVs
curl -o /tmp/lgd-states.csv https://raw.githubusercontent.com/planemad/india-local-government-directory/master/data/states.csv
curl -o /tmp/lgd-districts.csv https://raw.githubusercontent.com/planemad/india-local-government-directory/master/data/districts.csv

# 2. Run import script (creates hierarchy with parent_id links)
node scripts/import-lgd.mjs /tmp/lgd-states.csv /tmp/lgd-districts.csv

# Expected: ~36 states, ~780 districts inserted with parent-child relationships
# Blocks (6,700+) can be added similarly from blocks.csv
```

## Note
The location.locations table needs an `lgd_code` column added to store the official LGD numeric code.
This should be done via a proper migration, not ad-hoc ALTER TABLE.
