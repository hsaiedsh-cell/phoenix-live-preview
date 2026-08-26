-- Store the checkout URL selected by the operator for each project.
ALTER TABLE public_intake_fulfillments
  ADD COLUMN payment_url TEXT NULL;

ALTER TABLE public_intake_fulfillments
  ADD CONSTRAINT chk_intake_fulfillment_payment_url
  CHECK (payment_url IS NULL OR payment_url ~ '^https://');

-- Preserve the active project's checkout after replacing the retired PayPal link.
UPDATE public_intake_fulfillments
SET payment_url = 'https://pay.ziina.com/phoenixops/RNmUNhDjI?source=app'
WHERE status = 'payment_pending'
  AND payment_url IS NULL;
