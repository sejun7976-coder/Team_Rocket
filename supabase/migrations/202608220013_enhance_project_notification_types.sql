-- PostgreSQL requires newly-added enum values to be committed before a later
-- migration references them in functions or DML.
alter type public.notification_type add value if not exists 'task_updated';
alter type public.notification_type add value if not exists 'comment_added';
alter type public.notification_type add value if not exists 'file_uploaded';
alter type public.notification_type add value if not exists 'overdue';

notify pgrst, 'reload schema';
