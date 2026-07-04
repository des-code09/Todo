alter table todos
  add column due_date date not null default current_date;
