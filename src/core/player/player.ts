import { isInitialized, initial as playerInitial, isEmpty, setPause, setPlay, setResource, setStop, initTrackInfo } from '@/plugins/player'
import {
  setStatusText,
} from '@/core/player/playStatus'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import {
  getList,
  setPlayMusicInfo,
  setMusicInfo,
  setPlayListId,
} from '@/core/player/playInfo'
import {
  clearPlayedList,
  addPlayedList,
  removePlayedList,
} from '@/core/player/playedList'
import {
  clearTempPlayeList,
  removeTempPlayList,
} from '@/core/player/tempPlayList'
import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { submitPlayRequest, getLocalPath, isAutoSaveOnPlay } from '@/core/download'
import { enqueueOnPlay } from '@/core/download/idleDownloader'
import { requestMsg } from '@/utils/message'
import { getRandom } from '@/utils/common'
import { filterList } from './utils'
import BackgroundTimer from 'react-native-background-timer'
import { checkIgnoringBatteryOptimization, checkNotificationPermission, debounceBackgroundTimer } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import { addListMusics, removeListMusics } from '@/core/list'
import { addDislikeInfo } from '@/core/dislikeList'

// import { checkMusicFileAvailable } from '@renderer/utils/music'

const createDelayNextTimeout = (delay: number) => {
  let timeout: number | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      BackgroundTimer.clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = BackgroundTimer.setTimeout(() => {
      timeout = null
      if (global.lx.isPlayedStop) return
      console.log('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
/**
 * 妫€鏌ラ煶涔愪俊鎭槸鍚﹀凡鏇存敼
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playerState.playMusicInfo.musicInfo || playerState.isPlay
  return createGettingUrlId(curMusicInfo) != global.lx.gettingUrlId || curMusicInfo.id != playerState.playMusicInfo.musicInfo?.id || playerState.isPlay
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setStatusText(global.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false): Promise<string | null> => {
  const musicName = ('progress' in musicInfo ? musicInfo.metadata.musicInfo.name : musicInfo.name) ?? 'unknown'
  console.log(`[PLAYER] getMusicPlayUrl: name="${musicName}" isRefresh=${isRefresh} isRetryed=${isRetryed}`)
  setStatusText(global.i18n.t('player__getting_url'))
  addLoadTimeout()

  // const type = getPlayType(settingState.setting['player.isPlayHighQuality'], musicInfo)
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      musicInfo,
      isRefresh,
      onToggleSource(mInfo) {
        if (diffCurrentMusicInfo(musicInfo)) return
        setStatusText(global.i18n.t('toggle_source_try'))
      },
    })
  }).then(url => {
    if (global.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) { console.log(`[PLAYER] getMusicPlayUrl: result discarded (stopped or diff) name="${musicName}"`); return null }
    console.log(`[PLAYER] getMusicPlayUrl: SUCCESS name="${musicName}" url=${url ? url.substring(0, 80) : 'null'}`)
    return url
  }).catch(async err => {
    console.log(`[PLAYER] getMusicPlayUrl: ERROR name="${musicName}" err="${err.message}"`)
    if (global.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true)

    throw err
  })
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean) => {
  // addLoadTimeout()
  const musicName = ('progress' in musicInfo ? musicInfo.metadata.musicInfo.name : musicInfo.name) ?? 'unknown'
  const musicId = musicInfo.id
  console.log(`[PLAYER] setMusicUrl: id=${musicId} name="${musicName}" isRefresh=${!!isRefresh}`)
  if (!diffCurrentMusicInfo(musicInfo)) { console.log(`[PLAYER] setMusicUrl: SKIP (not diff) id=${musicId}`); return }
  if (cancelDelayRetry) cancelDelayRetry()
  global.lx.gettingUrlId = createGettingUrlId(musicInfo)

  // Download mode: check local 鈫?download 鈫?play from local
  if (isAutoSaveOnPlay()) {
    const onlineMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo) as LX.Music.MusicInfoOnline

    if (onlineMusicInfo.source !== 'local') {
      console.log(`[PLAYER] setMusicUrl: download mode, checking local registry for id=${musicId}`)
      // Step 1: Check local registry
      void getLocalPath(onlineMusicInfo).then(localPath => {
        if (!diffCurrentMusicInfo(musicInfo)) return

        if (localPath) {
          console.log(`[PLAYER] setMusicUrl: LOCAL HIT id=${musicId} path="${localPath}"`)
          // Found locally 鈥?play immediately, no network request
          setResource(musicInfo, localPath, playerState.progress.nowPlayTime)
          global.lx.gettingUrlId = ''
          clearLoadTimeout()
          return
        }

        console.log(`[PLAYER] setMusicUrl: LOCAL MISS, fetching URL for id=${musicId}`)
        // Step 2: Not local 鈥?get URL then submit to download scheduler
        void getMusicPlayUrl(musicInfo, isRefresh).then(url => {
          if (!url || !diffCurrentMusicInfo(musicInfo)) return
          console.log(`[PLAYER] setMusicUrl: URL fetched, submitting play download request id=${musicId} url=${url.substring(0, 80)}`)

          // Submit to scheduler: download first, then play
          void submitPlayRequest(
            onlineMusicInfo,
            (localPath) => {
              // Download complete 鈥?play from local file
              console.log(`[PLAYER] setMusicUrl: play download COMPLETE id=${musicId} path="${localPath}"`)
              if (diffCurrentMusicInfo(musicInfo)) {
                setResource(musicInfo, localPath, playerState.progress.nowPlayTime)
              }
              if (musicInfo === playerState.playMusicInfo.musicInfo) {
                global.lx.gettingUrlId = ''
                clearLoadTimeout()
              }
            },
            () => {
              // Download failed 鈥?fall back to streaming from URL
              console.log(`[PLAYER] setMusicUrl: play download FAILED, falling back to streaming id=${musicId} url=${url.substring(0, 80)}`)
              if (diffCurrentMusicInfo(musicInfo)) {
                setResource(musicInfo, url, playerState.progress.nowPlayTime)
              }
              if (musicInfo === playerState.playMusicInfo.musicInfo) {
                global.lx.gettingUrlId = ''
                clearLoadTimeout()
              }
            },
            url, // pass URL to avoid double fetch
          )
        }).catch((err: any) => {
          console.log(`[PLAYER] setMusicUrl: URL fetch FAILED id=${musicId} err="${err.message}"`)
          setStatusText(err.message as string)
          global.app_event.error()
          addDelayNextTimeout()
        })
      })
      return
    }
  }

  console.log(`[PLAYER] setMusicUrl: direct streaming mode id=${musicId}`)
  // Original behavior: play from URL directly
  void getMusicPlayUrl(musicInfo, isRefresh).then(async(url) => {
    if (!url) { console.log(`[PLAYER] setMusicUrl: URL is null, abort id=${musicId}`); return }
    console.log(`[PLAYER] setMusicUrl: URL OK, calling setResource id=${musicId} url=${url.substring(0, 80)}`)
    setResource(musicInfo, url, playerState.progress.nowPlayTime)

    // Enqueue for idle background download (non-blocking)
    if (!isAutoSaveOnPlay() && musicInfo && 'source' in musicInfo && musicInfo.source !== 'local') {
      void enqueueOnPlay(musicInfo as LX.Music.MusicInfoOnline)
    }
  }).catch((err: any) => {
    console.log(`[PLAYER] setMusicUrl: ERROR id=${musicId} err="${err.message}"`)
    setStatusText(err.message as string)
    global.app_event.error()
    addDelayNextTimeout()
  }).finally(() => {
    if (musicInfo === playerState.playMusicInfo.musicInfo) {
      global.lx.gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 鎭㈠涓婃鎾斁鐨勭姸鎬?
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playerState.playMusicInfo.musicInfo
  if (!musicInfo) return

  setTimeout(() => {
    global.app_event.setProgress(settingState.setting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
  })

  const playMusicInfo = playerState.playMusicInfo

  void initTrackInfo(musicInfo, playerState.musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url
    ) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })

  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)
}


const debouncePlay = debounceBackgroundTimer((musicInfo: LX.Player.PlayMusic) => {
  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playerState.playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playerState.playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })
}, 200)

// 澶勭悊闊充箰鎾斁
const handlePlay = async() => {
  const _mInfo = playerState.playMusicInfo.musicInfo
  const _name = _mInfo ? ('progress' in _mInfo ? _mInfo.metadata.musicInfo.name : _mInfo.name) : 'unknown'
  console.log(`[PLAYER] handlePlay: id=${_mInfo?.id ?? 'null'} name="${_name}" isInitialized=${isInitialized()} restorePlayInfo=${!!global.lx.restorePlayInfo}`)
  if (!isInitialized()) {
    console.log('[PLAYER] handlePlay: initializing native player...')
    await checkNotificationPermission()
    void checkIgnoringBatteryOptimization()
    await playerInitial({
      volume: settingState.setting['player.volume'],
      playRate: settingState.setting['player.playbackRate'],
      cacheSize: settingState.setting['player.cacheSize'] ? parseInt(settingState.setting['player.cacheSize']) : 0,
      isHandleAudioFocus: settingState.setting['player.isHandleAudioFocus'],
      isEnableAudioOffload: settingState.setting['player.isEnableAudioOffload'],
    })
  }

  global.lx.isPlayedStop &&= false
  resetRandomNextMusicInfo()

  if (global.lx.restorePlayInfo) {
    void handleRestorePlay(global.lx.restorePlayInfo)
    global.lx.restorePlayInfo = null
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  await setStop()
  global.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)

  debouncePlay(musicInfo)
}

/**
 * 鎾斁鍒楄〃鍐呮瓕鏇?
 * @param listId 鍒楄〃id
 * @param id 姝屾洸id
 */
export const playListById = async(listId: string, id: string) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  setPlayMusicInfo(listId, musicInfo)
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  await handlePlay()
}

/**
 * 鎾斁鍒楄〃鍐呮瓕鏇?
 * @param listId 鍒楄〃id
 * @param index 鎾斁鐨勬瓕鏇蹭綅缃?
 */
export const playList = async(listId: string, index: number) => {
  const list = getList(listId)
  const musicInfo = list[index]
  const _name = musicInfo ? ('progress' in musicInfo ? musicInfo.metadata.musicInfo.name : musicInfo.name) : 'unknown'
  console.log(`[PLAYER] playList: listId=${listId} index=${index} name="${_name}" id=${musicInfo?.id ?? 'null'} listSize=${list.length}`)
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  setPlayMusicInfo(listId, musicInfo)
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  await handlePlay()
}

const handleToggleStop = async() => {
  await stop()
  setTimeout(() => {
    setPlayMusicInfo(null, null)
  })
}


const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (playerState.tempPlayList.length) { // 濡傛灉绋嶅悗鎾斁鍒楄〃瀛樺湪姝屾洸鍒欑洿鎺ユ挱鏀炬敼鍒楄〃鐨勬瓕鏇?
    const playMusicInfo = playerState.tempPlayList[0]
    return playMusicInfo
  }

  if (playerState.playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) { // 绉婚櫎宸叉挱鏀惧垪琛ㄥ唴涓嶅瓨鍦ㄥ師鍒楄〃鐨勬瓕鏇?
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo!.id
    }
    // 浠庡凡鎾斁鍒楄〃绉婚櫎鎾斁鍒楄〃宸插垹闄ょ殑姝屾洸
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 閽堝涓嬭浇鍒楄〃锛屽鏋滆秴杩囦袱娆￠兘纰板埌鏃犳晥姝屾洸锛屽垯杩囨护鏁翠釜鍒楄〃鍐呯殑鏃犳晥姝屾洸
  let { filteredList, playerIndex } = await filterList({ // 杩囨护宸叉挱鏀炬瓕鏇?
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = async(playMusicInfo: LX.Player.PlayMusicInfo) => {
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  await handlePlay()
}
/**
 * 涓嬩竴鏇?
 * @param isAutoToggle 鏄惁鑷姩鍒囨崲
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  console.log(`[PLAYER] playNext: isAutoToggle=${isAutoToggle} currentId=${playerState.playMusicInfo.musicInfo?.id ?? 'null'}`)
  if (isAutoToggle) {
    const { onSongEnd } = await import('@/core/player/timeoutExit')
    onSongEnd()
  }
  if (playerState.tempPlayList.length) { // 濡傛灉绋嶅悗鎾斁鍒楄〃瀛樺湪姝屾洸鍒欑洿鎺ユ挱鏀炬敼鍒楄〃鐨勬瓕鏇?
    const playMusicInfo = playerState.tempPlayList[0]
    removeTempPlayList(0)
    await handlePlayNext(playMusicInfo)
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList

  if (playedList.length) { // 绉婚櫎宸叉挱鏀惧垪琛ㄥ唴涓嶅瓨鍦ㄥ師鍒楄〃鐨勬瓕鏇?
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 浠庡凡鎾斁鍒楄〃绉婚櫎鎾斁鍒楄〃宸插垹闄ょ殑姝屾洸
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      await handlePlayNext(playedList[index])
      return
    }
  }
  if (randomNextMusicInfo.info) {
    await handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 閽堝涓嬭浇鍒楄〃锛屽鏋滆秴杩囦袱娆￠兘纰板埌鏃犳晥姝屾洸锛屽垯杩囨护鏁翠釜鍒楄〃鍐呯殑鏃犳晥姝屾洸
  let { filteredList, playerIndex } = await filterList({ // 杩囨护宸叉挱鏀炬瓕鏇?
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return handleToggleStop()
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      return
  }
  if (nextIndex < 0) return

  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 涓婁竴鏇?
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  const playMusicInfo = playerState.playMusicInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()
  const playInfo = playerState.playInfo

  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 浠庡凡鎾斁鍒楄〃绉婚櫎鎾斁鍒楄〃宸插垹闄ょ殑姝屾洸
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      await handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 杩囨护宸叉挱鏀炬瓕鏇?
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!filteredList.length) return handleToggleStop()

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = settingState.setting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }


  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 鎭㈠鎾斁
 */
export const play = () => {
  if (playerState.playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playerState.playMusicInfo.musicInfo) != global.lx.gettingUrlId) setMusicUrl(playerState.playMusicInfo.musicInfo)
    return
  }
  void setPlay()
}

/**
 * 鏆傚仠鎾斁
 */
export const pause = async() => {
  await setPause()
}

/**
 * 鍋滄鎾斁
 */
export const stop = async() => {
  await setStop()
  setTimeout(() => {
    global.app_event.stop()
  })
}

/**
 * 鎾斁銆佹殏鍋滄挱鏀惧垏鎹?
 */
export const togglePlay = () => {
  global.lx.isPlayedStop &&= false
  if (playerState.isPlay) {
    void pause()
  } else {
    play()
  }
}

/**
 * 鏀惰棌褰撳墠鎾斁鐨勬瓕鏇?
 */
export const collectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void addListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo
      : playerState.playMusicInfo.musicInfo,
  ], settingState.setting['list.addMusicLocationType'])
}

/**
 * 鍙栨秷鏀惰棌褰撳墠鎾斁鐨勬瓕鏇?
 */
export const uncollectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void removeListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo.id
      : playerState.playMusicInfo.musicInfo.id,
  ])
}

/**
 * 涓嶅枩娆㈠綋鍓嶆挱鏀剧殑姝屾洸
 */
export const dislikeMusic = async() => {
  if (!playerState.playMusicInfo.musicInfo) return
  const minfo = 'progress' in playerState.playMusicInfo.musicInfo ? playerState.playMusicInfo.musicInfo.metadata.musicInfo : playerState.playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}

