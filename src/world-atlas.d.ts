// world-atlas ships TopoJSON as raw .json. Declare it as a typed Topology so tsc
// uses the type instead of inferring a ~100KB literal (slow + huge) from the file.
declare module 'world-atlas/countries-110m.json' {
  const topology: import('topojson-specification').Topology
  export default topology
}
