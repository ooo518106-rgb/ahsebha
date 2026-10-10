# Wallet design 1.85

Version 4 replaces the halo artwork with a large percentage, folded geometric starburst and a horizontal progress rail. The percentage and Arabic caption use bundled, OFL-licensed Readex Pro: weight 650 for figures, 500 for the caption and percent sign. Percentages use the actual reward progress, rounded down, and cannot show 100% until a reward is available. All filled dots and the “مكافأتك جاهزة” caption indicate an available reward. Other business types use this same neutral geometric composition.

Apple keeps its native merchant logo, points header, name, membership number and QR. Its text fields use Wallet's own font and layout; we cannot choose a custom typeface for those fields. Reward rules, progress status and menu links remain on the back. Status changes still have a `changeMessage`. The requested scan instruction is included in the back details because Apple controls the QR area. A complete card preview is an approximation of native layout, with the exact generated strip embedded; it is not a screenshot from an iPhone.

Google uses the same illustration in its hero aspect ratio. Its class template shows the current points, member name and membership number. Remaining points and reward details are retained in the details view. The rollout patches only class layout/labels and object hero images; it never overwrites live account identities, numeric balances or QR values. Class and member cursors persist each successful step so failures can resume without repeating completed updates.

Shop colour and logo are selected by the shop owner. Light palettes receive dark artwork and dark palettes receive ivory artwork. Names and membership numbers are native fields and are never placed in public hero image URLs.

## Rebuild artwork

Run `python scripts/build-wallet-type.py` with Pillow (RAQM), fonttools and brotli to regenerate `src/wallet-type.js` from `public/fonts/`. Run `node scripts/build-wallet-modern-masks.mjs` to regenerate `src/wallet-modern-masks.js` from the folded geometry. Workers only inflate cached masks and blend colours; they do not shape Arabic text or run trigonometry on requests.

The v2 coin renderer and v3 halo renderer remain byte-compatible. Version 4 URLs include the exact percentage as a seventh component. All three versions remain available because existing Google passes reference immutable hero URLs. PNG caches are bounded.

## Restore earlier designs

The remote branch `backup/wallet-before-halo-1.83` preserves the original release; commit `b731efdf3d6553c295255d0d07f4f81edc7ca583` preserves 1.84. For an artwork-only rollback, set `STRIP_VERSION` to 2 or 3, emit that version's original six-part image key, and bump `PASS_DESIGN_AT`. To restore the old front fields too, restore `buildPassJson` and Google's original class template in a new release and requeue layout updates. Keep every image version serving its original bytes.

The user approved publishing version 1.85 after reviewing the card and typography preview. Main deploys automatically through the existing Cloudflare integration.
