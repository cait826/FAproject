const PetContract = artifacts.require("PetContract");
module.exports = function(deployer){
    deployer.deploy(PetContract);
};

