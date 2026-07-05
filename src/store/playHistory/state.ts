export interface PlayHistoryState {
  entries: LX.Player.PlayHistoryEntry[]
  isLoaded: boolean
}

const state: PlayHistoryState = {
  entries: [],
  isLoaded: false,
}

export default state
