import { memo, useRef, useCallback } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { useI18n } from '@/lang'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { LXM_FILE_EXT_RXP } from '@/config/constant'
import { exportAllData, importAllData, validateBackupData } from '@/core/backup'
import { confirmDialog, handleReadFile, toast } from '@/utils/tools'
import { log } from '@/utils/log'

type Action = 'import' | 'export'

export default memo(() => {
  const t = useI18n()
  const choosePathRef = useRef<ChoosePathType>(null)
  const actionRef = useRef<Action>('import')

  const showChoosePath = useCallback((action: Action) => {
    actionRef.current = action
    requestAnimationFrame(() => {
      choosePathRef.current?.show({
        title: action === 'import' ? t('setting_backup_all_import_desc') : t('setting_backup_all_export_desc'),
        dirOnly: action === 'export',
        filter: action === 'import' ? LXM_FILE_EXT_RXP : undefined,
      })
    })
  }, [t])

  const handleConfirmPath = useCallback(async(path: string) => {
    if (actionRef.current === 'import') {
      try {
        const data = await handleReadFile(path)
        if (!validateBackupData(data)) {
          toast(t('setting_backup_all_import_error'))
          return
        }

        const confirmed = await confirmDialog({
          message: t('setting_backup_all_confirm'),
          cancelButtonText: global.i18n.t('dialog_cancel'),
          confirmButtonText: global.i18n.t('confirm_button_text'),
          bgClose: false,
        })
        if (!confirmed) return

        // Ask for import mode
        const isOverwrite = await confirmDialog({
          title: t('setting_backup_all_mode_title'),
          message: `${t('setting_backup_all_mode_overwrite_desc')}\n\n${t('setting_backup_all_mode_merge_desc')}`,
          cancelButtonText: t('setting_backup_all_mode_merge'),
          confirmButtonText: t('setting_backup_all_mode_overwrite'),
          bgClose: false,
        })

        await importAllData(data, isOverwrite ? 'overwrite' : 'merge')
        toast(t('setting_backup_all_import_success'))
      } catch (err: any) {
        log.error(err)
        toast(t('setting_backup_all_import_error') + ': ' + (err.message ?? ''))
      }
    } else {
      try {
        await exportAllData(path)
        toast(t('setting_backup_all_export_success'))
      } catch (err: any) {
        log.error(err)
        toast(t('setting_backup_all_export_error') + ': ' + (err.message ?? ''))
      }
    }
  }, [t])

  return (
    <>
      <SubTitle title={t('setting_backup_all')}>
        <View style={styles.list}>
          <Button onPress={() => showChoosePath('import')}>{t('setting_backup_all_import')}</Button>
          <Button onPress={() => showChoosePath('export')}>{t('setting_backup_all_export')}</Button>
        </View>
      </SubTitle>
      <ChoosePath ref={choosePathRef} onConfirm={handleConfirmPath} />
    </>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
  },
})
