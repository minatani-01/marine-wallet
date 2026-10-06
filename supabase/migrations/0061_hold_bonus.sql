-- ============================================================================
-- Marine Wallet / 0061_hold_bonus
-- ----------------------------------------------------------------------------
-- 投手ボーナスの「勝利投手」をやめ、「ホールド」を数える。
--
-- 勝利投手の金額は 0 のまま使われていなかった。先発が勝ちを付ける日は
-- 限られるのに対し、中継ぎがリードを守った日は多い。そちらを拾ったほうが
-- 積立が動く。
--
-- 勝利投手の列と金額は消さない。0061 より前の記録がその形で残っており、
-- 消すと当時の明細を説明できなくなる。これからは数えないだけにする。
--
-- ホールドは npb.jp のボックススコアに載っていない（責任投手は勝・敗・S
-- だけ）。個人投手成績を前日と比べて出す。組み立ては
-- lib/npb/contributors.ts にまとめてある。
--
-- すでに積み立てた分は変えない。has_hold は既定の false のままなので、
-- 過去の試合の金額は動かない。これから入る試合から数え始める。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 入れ物
-- ----------------------------------------------------------------------------
alter table public.games
  add column if not exists has_hold boolean not null default false;

comment on column public.games.has_hold is
  'ホールドが付いた投手がいたか。勝利投手の代わりに数える（0061）';

alter table public.saving_rule_settings
  add column if not exists hold_amount int not null default 100;

comment on column public.saving_rule_settings.hold_amount is
  'ホールド1試合あたりの金額（0061）';

-- ----------------------------------------------------------------------------
-- 2. 金額の計算
-- ----------------------------------------------------------------------------
-- 関数の本体は長く、ここに丸ごと書くと他の行まで巻き込んで書き換わる。
-- 置き換えたい1か所だけを差し替える。見つからなければ止める
-- （見つからないまま通すと、直ったつもりで直っていない）。
do $do$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public' and p.proname = 'calc_saving_for_game';

  if d is null then
    raise exception 'calc_saving_for_game が見つかりませんでした';
  end if;

  -- すでに当ててあれば何もしない
  if position('g.has_hold' in d) > 0 then
    return;
  end if;

  n := replace(d,
    $old$if g.is_winning_pitcher and r.winning_pitcher_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'winning_pitcher', 'label', '勝利投手', 'amount', r.winning_pitcher_amount);
  end if;$old$,
    $new$if g.has_hold and r.hold_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'hold', 'label', 'ホールド', 'amount', r.hold_amount);
  end if;$new$);

  if n = d then
    raise exception '置き換える箇所が見つかりませんでした';
  end if;

  execute n;
end
$do$;
