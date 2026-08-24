begin;

alter type public.admin_permission add value if not exists 'ai.logs.view';

commit;
