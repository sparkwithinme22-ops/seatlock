DO $$
BEGIN
  EXECUTE format(
    'GRANT seatlock_app TO %I WITH SET TRUE',
    current_user
  );
END
$$;
