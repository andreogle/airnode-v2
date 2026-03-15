import { afterAll, describe, expect, test } from 'bun:test';
import { type Hex, encodePacked, keccak256 } from 'viem';
import { recoverAddress, hashMessage } from 'viem';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { AIRNODE_ADDRESS, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

const OVERRIDE_DATA: Hex = '0x000000000000000000000000000000000000000000000000000000000000002a';

describe('S14 — Plugin hooks — onBeforeSign', () => {
  afterAll(() => {
    ctx.stop();
  });

  test('onBeforeSign can modify encoded data before signing', async () => {
    const signOverridePlugin: AirnodePlugin = {
      name: 'sign-override',
      hooks: {
        onBeforeSign: () => ({ data: OVERRIDE_DATA }),
      },
    };
    const plugins = createRegistry([{ plugin: signOverridePlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { endpointId: Hex; timestamp: number; data: Hex; signature: Hex };

    expect(response.status).toBe(200);
    // Data should be the plugin's override, not the actual API response encoding
    expect(body.data).toBe(OVERRIDE_DATA);

    // Signature should cover the overridden data
    const messageHash = keccak256(
      encodePacked(['bytes32', 'uint256', 'bytes'], [body.endpointId, BigInt(body.timestamp), body.data])
    );
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: body.signature,
    });
    expect(recovered).toBe(AIRNODE_ADDRESS);
  });
});
