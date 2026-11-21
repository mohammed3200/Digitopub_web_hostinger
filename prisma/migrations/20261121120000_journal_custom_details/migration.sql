-- #281: manager-defined label/value pairs shown in the public "Journal Details" card,
-- stored as an ordered JSON array [{"label": "...", "value": "..."}].
-- digitopub owns it; the OJS sync never writes this column.
ALTER TABLE `journals`
  ADD COLUMN `custom_details` JSON NULL AFTER `invitation_scope`;
