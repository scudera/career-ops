// @ts-check
/**
 * Countdown gate before final submit.
 *
 * Reached ONLY on the --auto-submit path (see index.mjs; default runs never
 * reach here). Pauses N seconds, displays countdown in terminal. User can
 * Ctrl-C to abort. SAFETY GATE — if the user cannot focus the terminal in
 * time, the submission proceeds. Use with care.
 *
 * @param {number} seconds — Countdown duration. 0 = no pause.
 */
export async function countdownGate(seconds) {
  if (seconds <= 0) {
    console.log('No review pause (--review-pause=0). Submitting immediately.');
    return;
  }

  console.log('');
  console.log('Form filled. Browser visible for review.');
  console.log(`Submitting in ${seconds}s. Ctrl-C to abort.`);
  console.log('');

  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r  Submit in ${i}s... `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write('\r  Submitting now.        \n');
}
