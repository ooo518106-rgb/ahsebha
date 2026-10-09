# Wallet design 1.84

Apple keeps its native merchant logo, points header, secondary fields and QR. The new strip contains a segmented halo and a large reward illustration. Google uses the same composition in its hero aspect ratio. Shop colour, points rules, card identity and customer data remain unchanged.

The coffee illustration has transparent edges. Other businesses use their corresponding reward icon. A full ring and gift indicate an available reward; partial rings use the existing points/stamps calculation. Small thresholds have one segment per unit; larger thresholds use ten progress segments.

`src/wallet-geometry.js` defines vector masks. Run `node scripts/build-wallet-masks.mjs` to regenerate `src/wallet-masks.js` after a geometry change. The generated masks avoid trigonometric rendering on every request. `src/reward-art.js` embeds the compressed RGBA pixels of `public/img/reward-cup.png`, so runtime rendering needs no external image service. Decoded masks and finished PNGs have bounded caches.

Existing Apple registrations are queued once for a silent update. Existing Google objects receive the new hero URI in batches of three per scheduled run, with a persisted cursor and retries after failures. This job never updates member records. Newly saved passes and normal points updates use the new artwork immediately.

## Restore the classic design

The remote branch `backup/wallet-before-halo-1.83` preserves the original version. For a Wallet-only rollback, keep this release's public image endpoint and change `STRIP_VERSION` in `src/strip.js` from 3 to 2. Bump `PASS_DESIGN_AT` in `src/app.js` to the rollback's UTC time, add a new changelog release, run tests and deploy. The changed revision requeues existing Wallet cards. The existing `strip-classic.js` generates the original coin design.

Keep both version 2 and version 3 URLs serving their original bytes: Google stores immutable hero URLs. Avoid restoring the entire repository if unrelated changes have been made since the backup.
