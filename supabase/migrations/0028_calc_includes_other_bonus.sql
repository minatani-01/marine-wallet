-- ============================================================================
-- Marine Wallet / 0028_calc_includes_other_bonus
-- ----------------------------------------------------------------------------
-- 試合の積立を作るDB側の計算に、その他ボーナスを入れる。
--
-- 0027 で other_amount / other_note を saving_entries から games へ移したが、
-- DB側の計算（calc_saving_for_game）と自動生成（sync_saving_entries_for_game）は
-- その他ボーナスを見ていなかった。games に行が入るとトリガーが全員分の積立を
-- 作るので、このままでは
--   - 登録した本人は画面側の計算で正しい額になる
--   - それ以外の人はその他ボーナスが抜けた額になる
-- という、0027 で消したはずの食い違いがDB側に残る。
--
-- lib/savings.ts の calcSaving と同じ順序・同じ扱いにする。
-- その他ボーナスは内訳の最後に置き、フェーズ倍率は合計に対してかける。
--
-- 冪等性: 関数の置き換えなので何度実行しても安全。
-- ============================================================================

create or replace function public.calc_saving_for_game(p_game_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  g public.games;
  r public.saving_rule_settings;
  lines jsonb := '[]'::jsonb;
  subtotal int := 0;
  multiplier numeric;
  highlight_key text;
  highlight_label text;
  highlight_amount int;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return jsonb_build_object('amount', 0, 'breakdown', '[]'::jsonb);
  end if;
  select * into r from public.saving_rule_settings where id;
  if not found then
    return jsonb_build_object('amount', 0, 'breakdown', '[]'::jsonb);
  end if;

  if g.result = 'win' then
    lines := lines || jsonb_build_object('key', 'win', 'label', '勝利', 'amount', r.win_amount);
    if g.is_sayonara and r.sayonara_bonus > 0 then
      lines := lines || jsonb_build_object(
        'key', 'sayonara', 'label', 'サヨナラ勝利', 'amount', r.sayonara_bonus);
    end if;
  elsif g.result = 'draw' then
    lines := lines || jsonb_build_object('key', 'draw', 'label', '引き分け', 'amount', r.draw_amount);
  elsif r.lose_amount > 0 then
    lines := lines || jsonb_build_object('key', 'lose', 'label', '敗北', 'amount', r.lose_amount);
  end if;

  if g.home_runs > 0 and r.home_run_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'home_run',
      'label', format('ホームラン %s本', g.home_runs),
      'amount', g.home_runs * r.home_run_amount);
  end if;
  if g.grand_slams > 0 and r.grand_slam_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'grand_slam',
      'label', format('満塁ホームラン %s本', g.grand_slams),
      'amount', g.grand_slams * r.grand_slam_amount);
  end if;
  if g.multi_hits > 0 and r.multi_hit_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'multi_hit',
      'label', format('マルチ安打 %s人', g.multi_hits),
      'amount', g.multi_hits * r.multi_hit_amount);
  end if;
  if g.rbi > 0 and r.rbi_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'rbi',
      'label', format('打点 %s', g.rbi),
      'amount', g.rbi * r.rbi_amount);
  end if;

  highlight_key := null;
  if g.pitching_highlight = 'perfect_game' then
    highlight_key := 'perfect_game'; highlight_label := '完全試合'; highlight_amount := r.perfect_game_amount;
  elsif g.pitching_highlight = 'no_hitter' then
    highlight_key := 'no_hitter'; highlight_label := 'ノーヒットノーラン'; highlight_amount := r.no_hitter_amount;
  elsif g.pitching_highlight = 'shutout' then
    highlight_key := 'shutout'; highlight_label := '完封'; highlight_amount := r.shutout_amount;
  elsif g.pitching_highlight = 'complete_game' then
    highlight_key := 'complete_game'; highlight_label := '完投'; highlight_amount := r.complete_game_amount;
  elsif g.pitching_highlight = 'quality_start' then
    highlight_key := 'quality_start'; highlight_label := 'QS'; highlight_amount := r.quality_start_amount;
  end if;
  if highlight_key is not null and highlight_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', highlight_key, 'label', highlight_label, 'amount', highlight_amount);
  end if;

  if g.is_winning_pitcher and r.winning_pitcher_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'winning_pitcher', 'label', '勝利投手', 'amount', r.winning_pitcher_amount);
  end if;
  if g.has_save and r.save_amount > 0 then
    lines := lines || jsonb_build_object('key', 'save', 'label', 'セーブ', 'amount', r.save_amount);
  end if;

  -- その他ボーナスは試合の持ち物（0027）。内訳の最後に置くのは calcSaving と同じ
  if g.other_amount > 0 then
    lines := lines || jsonb_build_object(
      'key', 'other', 'label', 'その他ボーナス', 'amount', g.other_amount);
  end if;

  select coalesce(sum((line->>'amount')::int), 0) into subtotal
  from jsonb_array_elements(lines) line;

  multiplier := case g.phase
    when 'interleague' then r.multiplier_interleague
    when 'cs' then r.multiplier_cs
    when 'nippon_series' then r.multiplier_nippon_series
    else r.multiplier_regular
  end;

  return jsonb_build_object('amount', round(subtotal * multiplier)::int, 'breakdown', lines);
end;
$function$;

-- 自動生成する積立にも、試合のその他ボーナスを写す
create or replace function public.sync_saving_entries_for_game(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  g public.games;
  calc jsonb;
  made int;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return 0;
  end if;

  calc := public.calc_saving_for_game(p_game_id);

  insert into public.saving_entries (
    user_id, game_id, kind, title, entry_date, amount, breakdown, other_amount, other_note
  )
  select u, g.id, 'game', '', g.game_date,
         (calc->>'amount')::int, calc->'breakdown', g.other_amount, g.other_note
  from public.saving_target_users() u
  on conflict (user_id, game_id) do nothing;

  get diagnostics made = row_count;
  return made;
end;
$function$;
