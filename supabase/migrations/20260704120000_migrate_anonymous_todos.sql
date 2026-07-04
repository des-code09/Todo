-- Reassign todos from an anonymous user to the currently signed-in permanent account.
create or replace function public.migrate_anonymous_todos(anonymous_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  migrated_count integer;
  is_caller_anonymous boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  is_caller_anonymous := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  if is_caller_anonymous then
    raise exception 'Permanent account required to migrate todos';
  end if;

  if anonymous_user_id is null or anonymous_user_id = auth.uid() then
    return 0;
  end if;

  update public.todos
  set user_id = auth.uid()
  where user_id = anonymous_user_id;

  get diagnostics migrated_count = row_count;
  return migrated_count;
end;
$$;

revoke all on function public.migrate_anonymous_todos(uuid) from public;
grant execute on function public.migrate_anonymous_todos(uuid) to authenticated;
