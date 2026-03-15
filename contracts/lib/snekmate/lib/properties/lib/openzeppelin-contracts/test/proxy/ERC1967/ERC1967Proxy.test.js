const shouldBehaveLikeProxy = require('../Proxy.behaviour');

const ERC1967Proxy = artifacts.require('ERC1967Proxy');

contract('ERC1967Proxy', function (accounts) {
  const [proxyAdminOwner] = accounts;

  const createProxy = async function (implementation, _admin, initData, options) {
    return ERC1967Proxy.new(implementation, initData, options);
  };

  shouldBehaveLikeProxy(createProxy, undefined, proxyAdminOwner);
});
