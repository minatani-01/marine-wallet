-- ============================================================================
-- Marine Wallet / 0062_hold_count
-- ----------------------------------------------------------------------------
-- ホールドを「付いたか / 付かなかったか」ではなく、人数で数える。
--
-- 1試合に2人以上付くことは珍しくない。実際 10/2 は鈴木と中森の2人に
-- 付いている。付いた人数ぶん積み立てたほうが、守った回数に見合う。
--
-- ホームランと同じ数え方にそろえる。あちらも本数ぶん足している。
--
-- 0061 で足した has_hold は消さない。使うのをやめるだけにする。入ったのが
-- 1日前で、どの試合も false のままなので中身は無いが、残しておいても
-- 邪魔にならない。消す操作で別のものを巻き込むほうが怖い。
--
-- すでに積み立てた分は変えない。holds は既定の 0 のままなので、過去の
-- 試合の金額は動かない。
--
-- 冪等性: 何度実行しても安全。
-- ============================================================================

alter table public.games
  add column if not exists holds int not null default 0;

comment on column public.games.holds is
  'ホールドが付いた投手の人数。1試合に2人以上付くことがある（0062）';

comment on column public.saving_rule_settings.hold_amount is
  'ホールド1人あたりの金額（0062）';

-- ----------------------------------------------------------------------------
-- 金額の計算
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
  if position('g.holds > 0' in d) > 0 then
    return;
  end if;

  n := replace(d,
    $old$if g.has_hold and r.hold_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'hold', 'label', 'ホールド', 'amount', r.hold_amount);
  end if;$old$,
    $new$if g.holds > 0 and r.hold_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'hold', 'label', 'ホールド ' || g.holds || '人',
      'amount', g.holds * r.hold_amount);
  end if;$new$);

  if n = d then
    raise exception '置き換える箇所が見つかりませんでした';
  end if;

  execute n;
end
$do$;
