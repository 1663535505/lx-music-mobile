import { useState, useEffect, useCallback } from 'react'
import state from './state'

export const usePlayHistory = () => {
  const [entries, setEntries] = useState(state.entries)

  useEffect(() => {
    const handler = (newEntries: LX.Player.PlayHistoryEntry[]) => {
      setEntries(newEntries)
    }
    global.state_event.on('playHistoryChanged', handler)
    setEntries(state.entries)
    return () => {
      global.state_event.off('playHistoryChanged', handler)
    }
  }, [])

  const recentlyPlayed = entries
  const mostPlayed = [...entries].sort((a, b) => b.playCount - a.playCount)

  return { entries, recentlyPlayed, mostPlayed, isLoaded: state.isLoaded }
}
