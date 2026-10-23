# Deploy a schema safely

1. Apply the additive migration while the old application version is still running.
2. Verify that both application versions can read the new schema.
3. Deploy the new application version.
4. Backfill historical rows in bounded batches.
5. Remove obsolete columns only in a later release after rollback is no longer needed.

If the migration fails, stop before deploying the new application. If the new application fails, restore the previous image and keep the additive schema.
