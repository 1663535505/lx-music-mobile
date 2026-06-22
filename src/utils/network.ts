let NetInfo: any = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NetInfo = require('@react-native-community/netinfo')
} catch {
  // library not installed
}

/**
 * Check if the device is on a WiFi connection.
 * Returns true if wifi, false if cellular/other, null if unable to determine.
 */
export const isWifi = async(): Promise<boolean | null> => {
  if (!NetInfo) return null
  try {
    const state = await NetInfo.fetch()
    return state.type === 'wifi'
  } catch {
    return null
  }
}
