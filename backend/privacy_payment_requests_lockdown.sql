drop policy if exists privacy_payment_submit on public.privacy_payments;
revoke insert on public.privacy_payments from public, anon, authenticated;