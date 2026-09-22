'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Field, SectionLabel, inputClassCompact } from '@/components/ui'
import { IconExternal } from '@/components/icons'
import { loadAppLinks, saveAppLinks, type AppLinks } from '@/components/HandoffActions'
import { EXTERNAL_APPS, type ExternalAppKey } from '@/lib/constants'

/**
 * 外部アプリの起動URLを、この端末だけで差し替える。
 *
 * 同じアプリでも、開ける形は端末によって違う。Android は intent スキーム、
 * iOS は独自スキームか App Store のページになる。組み込みの既定値で
 * 開けないときに、ここで書き換える。
 *
 * 保存先は端末の中（localStorage）で、相手には共有しない。
 *
 * 「試す」を押すと、保存せずにその場で開く。開くものが正しいか分からない
 * まま保存すると、何が効いているのか分からなくなる。
 */
export default function AppLinkSettings() {
  const [links, setLinks] = useState<AppLinks>({})
  const [saved, setSaved] = useState(false)

  // localStorage はブラウザにしか無い。読み込みはマウント後に行う
  useEffect(() => setLinks(loadAppLinks()), [])

  const keys = Object.keys(EXTERNAL_APPS) as ExternalAppKey[]

  const save = () => {
    saveAppLinks(links)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div>
      <SectionLabel>アプリの起動</SectionLabel>
      <Card>
        <div className="flex flex-col gap-4">
          {keys.map((key) => {
            const meta = EXTERNAL_APPS[key]
            const value = links[key] ?? ''

            return (
              <Field key={key} label={meta.label} hint={meta.hint}>
                <div className="flex gap-2">
                  <input
                    className={inputClassCompact}
                    value={value}
                    onChange={(e) => setLinks({ ...links, [key]: e.target.value })}
                    placeholder={meta.defaultUrl}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <a
                    href={value || meta.defaultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] text-fg-dim transition-colors hover:border-marine/50 hover:text-marine"
                  >
                    <IconExternal size={15} />
                    試す
                  </a>
                </div>
                {meta.note ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-fg-mute">{meta.note}</p>
                ) : null}

                {/* 当たりを探すための候補。押すと開くだけで、保存はしない。
                    開いたものを上の欄に入れて保存する */}
                {meta.candidates ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {meta.candidates.map((candidate) => (
                      <a
                        key={candidate.url}
                        href={candidate.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setLinks({ ...links, [key]: candidate.url })}
                        className="inline-flex min-h-[32px] items-center rounded-full border border-line px-3 text-[11px] text-fg-mute transition-colors hover:border-marine/50 hover:text-marine"
                      >
                        {candidate.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </Field>
            )
          })}

          <Button variant="primary" full onClick={save}>
            {saved ? '保存しました' : 'この端末に保存する'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
