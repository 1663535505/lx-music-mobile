import { getPlayHistory, savePlayHistory } from '@/utils/data'
import playHistoryAction from '@/store/playHistory/action'
import playHistoryState from '@/store/playHistory/state'

export const initPlayHistory = async() => {
  const entries = await getPlayHistory()
  playHistoryAction.setEntries(entries)
}

export const addPlayHistory = (musicInfo: LX.Player.PlayMusic, listId: string | null) => {
  const musicId = musicInfo.id
  if (!musicId) return

  const entry: LX.Player.PlayHistoryEntry = {
    musicId,
    musicInfo,
    listId,
    playedAt: Date.now(),
    playCount: 1,
  }

  const idx = playHistoryState.entries.findIndex(e => e.musicId === musicId)
  if (idx !== -1) {
    entry.playCount = playHistoryState.entries[idx].playCount + 1
  }

  playHistoryAction.addOrUpdateEntry(entry)
  savePlayHistory(playHistoryState.entries)
}

export const removePlayHistoryEntry = (musicId: string) => {
  playHistoryAction.removeEntry(musicId)
  savePlayHistory(playHistoryState.entries)
}

export const clearPlayHistory = () => {
  playHistoryAction.clearHistory()
  savePlayHistory([])
}
