import { useEffect, useRef, useCallback } from 'react'

import MusicList, { type MusicListType } from './MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { type ListInfoItem } from '@/store/songlist/state'
import PlayerBar from '@/components/player/PlayerBar'
import { ListInfoContext } from './state'
import { isAutoDownloadList, downloadPlaylist } from '@/core/download'
import songlistState from '@/store/songlist/state'
import { setTempList } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { toast } from '@/utils/tools'


export default ({ componentId, info }: { componentId: string, info: ListInfoItem }) => {
  const musicListRef = useRef<MusicListType>(null)
  const isUnmountedRef = useRef(false)
  const autoDownloadTriggeredRef = useRef(false)

  useEffect(() => {
    setComponentId(COMPONENT_IDS.songlistDetail, componentId)

    isUnmountedRef.current = false
    autoDownloadTriggeredRef.current = false

    musicListRef.current?.loadList(info.source, info.id)


    return () => {
      isUnmountedRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // auto-download trigger when entering songlist detail
  useEffect(() => {
    if (!isAutoDownloadList()) return
    const listId = `${info.source}__${info.id}`
    const checkAndDownload = () => {
      if (autoDownloadTriggeredRef.current) return
      const list = songlistState.listDetailInfo.list
      if (list.length > 0) {
        autoDownloadTriggeredRef.current = true
        void setTempList(listId, [...list]).then(() => {
          return downloadPlaylist(LIST_IDS.TEMP)
        }).then((count) => {
          if (count > 0) {
            toast(`已自动添加 ${count} 首歌曲到下载队列`)
          }
        })
      }
    }
    // check after a delay to allow list loading
    const timer = setTimeout(checkAndDownload, 2000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEnterMultiSelectMode = useCallback(() => {
    musicListRef.current?.enterMultiSelectMode()
  }, [])


  return (
    <PageContent>
      <StatusBar />
      <ListInfoContext.Provider value={info}>
        <MusicList ref={musicListRef} componentId={componentId} onEnterMultiSelectMode={handleEnterMultiSelectMode} />
      </ListInfoContext.Provider>
      <PlayerBar />
    </PageContent>
  )
}

// const styles = createStyle({
//   container: {
//     width: '100%',
//     flex: 1,
//     flexDirection: 'row',
//     borderTopWidth: BorderWidths.normal,
//   },
//   content: {
//     flex: 1,
//   },
// })
