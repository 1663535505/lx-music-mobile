import state from './state'

export default {
  setEntries(entries: LX.Player.PlayHistoryEntry[]) {
    state.entries = entries
    state.isLoaded = true
    global.state_event.playHistoryChanged([...state.entries])
  },
  addOrUpdateEntry(entry: LX.Player.PlayHistoryEntry) {
    const idx = state.entries.findIndex(e => e.musicId === entry.musicId)
    if (idx !== -1) {
      state.entries.splice(idx, 1)
    }
    state.entries.unshift(entry)
    if (state.entries.length > 100) {
      state.entries.length = 100
    }
    global.state_event.playHistoryChanged([...state.entries])
  },
  removeEntry(musicId: string) {
    const idx = state.entries.findIndex(e => e.musicId === musicId)
    if (idx !== -1) {
      state.entries.splice(idx, 1)
      global.state_event.playHistoryChanged([...state.entries])
    }
  },
  clearHistory() {
    state.entries = []
    global.state_event.playHistoryChanged([...state.entries])
  },
}
