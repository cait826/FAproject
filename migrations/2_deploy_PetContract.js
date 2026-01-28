const RepublicSurpriseContract = artifacts.require("RepublicSurpriseContract");

module.exports = function(deployer) {
  deployer.deploy(RepublicSurpriseContract);
};
