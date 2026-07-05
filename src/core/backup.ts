import { saveDataMultiple } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { overwriteListFull, getListMusics } from '@/core/list'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'
import {
  getSearchHistory, saveSearchHistory,
  getDislikeListRules, saveDislikeListRules,
  getUserApiList, getUserApiScript,
  getDownloadRegistry, saveDownloadRegistry,
  getPlayHistory, savePlayHistory,
} from '@/utils/data'
import { handleSaveFile, handleReadFile, confirmDialog, toast } from '@/utils/tools'
import { filterMusicList, fixNewMusicInfoQuality } from '@/utils'
import { log } from '@/utils/log'

interface FullBackupData {
  type: 'fullBackup_v1'
  version: 1
  createdAt: number
  data: {
    lists: {
      defaultList: LX.Music.MusicInfo[]
      loveList: LX.Music.MusicInfo[]
      userList: LX.List.UserListInfoFull[]
    }
    setting: LX.AppSetting
    dislikeRules: string
    downloadRegistry: Record<string, { filePath: string; downloadedAt: number; quality: string }>
    searchHistory: string[]
    playHistory: LX.Player.PlayHistoryEntry[]
    userApis: { info: LX.UserApi.UserApiInfo; script: string }[]
  }
}

const getAllLists = async() => {
  const lists: Array<LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull> = []
  lists.push({ ...listState.defaultList, list: await getListMusics(listState.defaultList.id) })
  lists.push({ ...listState.loveList, list: await getListMusics(listState.loveList.id) })

  for (const list of listState.userList) {
    lists.push({ ...list, list: await getListMusics(list.id) })
  }

  return lists
}

export const exportAllData = async(dirPath: string) => {
  const lists = await getAllLists()
  const defaultList = lists[0].list
  const loveList = lists[1].list
  const userList = lists.slice(2) as LX.List.UserListInfoFull[]

  const [dislikeRules, searchHistory, playHistory, userApiList, downloadRegistry] = await Promise.all([
    getDislikeListRules(),
    getSearchHistory(),
    getPlayHistory(),
    getUserApiList(),
    getDownloadRegistry(),
  ])

  const userApis: FullBackupData['data']['userApis'] = []
  for (const api of userApiList) {
    const script = await getUserApiScript(api.id)
    userApis.push({ info: api, script })
  }

  const registryObj: FullBackupData['data']['downloadRegistry'] = {}
  for (const [key, entry] of downloadRegistry) {
    registryObj[key] = {
      filePath: entry.filePath,
      quality: entry.quality,
      downloadedAt: entry.downloadedAt,
    }
  }

  const backupData: FullBackupData = {
    type: 'fullBackup_v1',
    version: 1,
    createdAt: Date.now(),
    data: {
      lists: { defaultList, loveList, userList },
      setting: { ...settingState.setting },
      dislikeRules,
      downloadRegistry: registryObj,
      searchHistory,
      playHistory,
      userApis,
    },
  }

  const date = new Date()
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  await handleSaveFile(`${dirPath}/lx_full_backup_${dateStr}.lxmb`, backupData)
}

export const validateBackupData = (data: any): data is FullBackupData => {
  return data?.type === 'fullBackup_v1' && data?.version === 1 && data?.data != null
}

const importListsOverwrite = async(lists: FullBackupData['data']['lists']) => {
  const defaultList = filterMusicList(lists.defaultList).map(m => fixNewMusicInfoQuality(m))
  const loveList = filterMusicList(lists.loveList).map(m => fixNewMusicInfoQuality(m))
  const userList = lists.userList.map(l => ({
    ...l,
    list: filterMusicList(l.list).map(m => fixNewMusicInfoQuality(m)),
  }))
  await overwriteListFull({ defaultList, loveList, userList })
}

const importListsMerge = async(lists: FullBackupData['data']['lists']) => {
  const allLists = await getAllLists()
  const importedLists: Array<LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull> = [
    { ...listState.defaultList, list: lists.defaultList },
    { ...listState.loveList, list: lists.loveList },
    ...lists.userList,
  ]

  for (const list of importedLists) {
    const targetList = allLists.find(l => l.id === list.id)
    if (targetList) {
      const existingIds = new Set(targetList.list.map(m => m.id))
      const newSongs = filterMusicList(list.list)
        .map(m => fixNewMusicInfoQuality(m))
        .filter(m => !existingIds.has(m.id))
      targetList.list.push(...newSongs)
    } else {
      allLists.push({
        ...list,
        list: filterMusicList(list.list).map(m => fixNewMusicInfoQuality(m)),
      } as LX.List.UserListInfoFull)
    }
  }

  const defaultList = allLists.shift()!.list
  const loveList = allLists.shift()!.list
  await overwriteListFull({ defaultList, loveList, userList: allLists as LX.List.UserListInfoFull[] })
}

export const importAllData = async(data: FullBackupData, mode: 'overwrite' | 'merge') => {
  const { lists, setting, dislikeRules, searchHistory, playHistory, userApis } = data.data

  if (mode === 'overwrite') {
    await importListsOverwrite(lists)
  } else {
    await importListsMerge(lists)
  }

  // Restore settings
  const { updateSetting } = await import('@/core/common')
  updateSetting(setting)

  // Restore dislike rules
  await saveDislikeListRules(dislikeRules)

  // Restore search history
  await saveSearchHistory(searchHistory)

  // Restore play history
  if (playHistory?.length) {
    await savePlayHistory(playHistory)
  }

  // Restore user APIs
  if (userApis?.length) {
    const userApiPrefix = storageDataPrefix.userApi
    const existingApis = await getUserApiList()
    const existingIds = new Set(existingApis.map(a => a.id))
    const apisToSave = [...existingApis]
    const scriptsToSave: Array<[string, string]> = []

    for (const { info, script } of userApis) {
      if (mode === 'merge' && existingIds.has(info.id)) continue
      if (!existingIds.has(info.id)) {
        apisToSave.push(info)
      }
      scriptsToSave.push([`${userApiPrefix}${info.id}`, script])
    }

    await saveDataMultiple([
      [userApiPrefix, apisToSave],
      ...scriptsToSave,
    ])
  }

  // Restore download registry (verify files exist)
  if (data.data.downloadRegistry) {
    const { existsFile } = await import('@/utils/fs')
    const registry = new Map()
    for (const [key, entry] of Object.entries(data.data.downloadRegistry)) {
      try {
        if (await existsFile(entry.filePath)) {
          registry.set(key, entry)
        }
      } catch {
        // Skip entries with missing files
      }
    }
    await saveDownloadRegistry(registry)
  }
}
