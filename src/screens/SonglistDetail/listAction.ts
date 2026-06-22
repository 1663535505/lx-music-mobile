import { createList, setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { downloadPlaylist } from '@/core/download'
import { getListDetail, getListDetailAll } from '@/core/songlist'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import syncSourceList from '@/core/syncSourceList'
import { confirmDialog, toMD5, toast } from '@/utils/tools'
import { type Source } from '@/store/songlist/state'

const getListId = (id: string, source: LX.OnlineSource) => `${source}__${id}`

export const handlePlay = async(id: string, source: Source, list?: LX.Music.MusicInfoOnline[], index = 0) => {
  const listId = getListId(id, source)
  let isPlayingList = false
  // console.log(list)
  if (!list?.length) list = (await getListDetail(id, source, 1)).list
  if (list?.length) {
    await setTempList(listId, [...list])
    void playList(LIST_IDS.TEMP, index)
    isPlayingList = true
  }
  const fullList = await getListDetailAll(source, id)
  if (!fullList.length) return
  if (isPlayingList) {
    if (listState.tempListMeta.id == listId) {
      await setTempList(listId, [...fullList])
    }
  } else {
    await setTempList(listId, [...fullList])
    void playList(LIST_IDS.TEMP, index)
  }
}

export const handleCollect = async(id: string, source: Source, name: string) => {
  const listId = getListId(id, source)

  const targetList = listState.userList.find(l => l.sourceListId == listId)
  if (targetList) {
    const confirm = await confirmDialog({
      message: global.i18n.t('duplicate_list_tip', { name: targetList.name }),
      cancelButtonText: global.i18n.t('list_import_part_button_cancel'),
      confirmButtonText: global.i18n.t('confirm_button_text'),
    })
    if (!confirm) return
    void syncSourceList(targetList)
    return
  }

  const list = await getListDetailAll(source, id)
  await createList({
    name,
    id: `${source}_${toMD5(listId)}`,
    list,
    source,
    sourceListId: id,
  })
  toast(global.i18n.t('collect_success'))
}

export const handleDownloadAll = async(id: string, source: Source, list?: LX.Music.MusicInfoOnline[]) => {
  if (!list?.length) list = (await getListDetail(id, source, 1)).list
  if (!list?.length) {
    toast('没有可下载的歌曲')
    return
  }

  const confirm = await confirmDialog({
    title: '歌单下载',
    message: `共 ${list.length} 首歌曲，是否添加到下载队列？`,
    confirmButtonText: global.i18n.t('confirm_button_text'),
  })
  if (!confirm) return

  // set list to temp so downloadPlaylist can access it
  const listId = getListId(id, source)
  await setTempList(listId, [...list])
  const count = await downloadPlaylist(LIST_IDS.TEMP)
  if (count > 0) {
    toast(`已添加 ${count} 首歌曲到下载队列`)
  } else {
    toast('所有歌曲已在下载队列中')
  }
}
