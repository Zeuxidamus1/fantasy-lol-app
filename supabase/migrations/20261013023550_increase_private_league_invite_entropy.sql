create or replace function public.new_invite_code()
returns text
language plpgsql
security definer
set search_path='public'
as $function$
declare
  code text;
begin
  loop
    code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    exit when not exists(select 1 from public.leagues where invite_code=code);
  end loop;
  return code;
end;
$function$;

revoke all on function public.new_invite_code() from public,anon,authenticated;
grant execute on function public.new_invite_code() to service_role;
