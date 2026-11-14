/** MODULE_SOURCE=catalogue switches the module catalogue on as the single source (M4). Default off. */
export function catalogueIsSource(): boolean {
  return process.env.MODULE_SOURCE === "catalogue";
}
