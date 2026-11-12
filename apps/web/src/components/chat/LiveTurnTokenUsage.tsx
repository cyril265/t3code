import { useAtomValue } from "@effect/atom-react";
import { formatLiveTurnTokenUsage } from "@t3tools/client-runtime/state/turn-token-rate";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { environmentThreadDetails } from "../../state/threads";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LiveTurnTokenUsage({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const turn = useAtomValue(environmentThreadDetails.activeTokenRateTurnAtom(threadRef));
  const label = formatLiveTurnTokenUsage(turn);
  if (label === null) return null;
  return (
    <div className="chat-content-lane px-1 py-1 text-xs tabular-nums text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>{label}</TooltipTrigger>
        <TooltipPopup>
          Output tokens reported so far, including reasoning. Updates when the provider reports
          usage. The average includes tool calls and waits.
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
