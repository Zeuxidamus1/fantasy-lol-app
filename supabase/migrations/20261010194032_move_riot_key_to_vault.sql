
create or replace function public.get_backend_secret(p_name text)
returns text
language sql
stable
security definer
set search_path=vault,pg_temp
as $fn$
  select decrypted_secret
  from vault.decrypted_secrets
  where name=p_name
  limit 1;
$fn$;

revoke all on function public.get_backend_secret(text) from public,anon,authenticated;
grant execute on function public.get_backend_secret(text) to service_role;
