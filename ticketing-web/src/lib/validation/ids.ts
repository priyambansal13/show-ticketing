/** Route id formats, checked before calling the API so malformed URLs show "not found" immediately. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OBJECT_ID = /^[0-9a-f]{24}$/;
