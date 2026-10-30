// Product input limits shared by HTTP validation and ingestion.
export const MAX_MATERIAL_TITLE_LENGTH = 160;
export const MAX_MATERIAL_LENGTH = 500_000;
export const MIN_READABLE_TEXT_LENGTH = 20;
export const MAX_UPLOAD_MIB = 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MIB * 1024 * 1024;
