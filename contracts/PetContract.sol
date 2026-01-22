// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RepublicSurpriseContract {
    enum RepublicSurpriseStatus {InStock, OutOfStock}

    string public companyName;

    // Constructor code is only run when the contract is created
    constructor() {
        companyName = "Republic Surprise Shop";
    }

    //declare the structure of the product data
    struct Product {
        uint id;
        string name;
        string description;
        uint price;
        RepublicSurpriseStatus status;
    }
    
    //declare the structure of the product data
    struct Customer {
        uint id;
        string name;
        string description;
        uint price;
        RepublicSurpriseStatus status;
    }
    mapping(uint => Product) public products;

    function addProduct(uint id, string memory name, string memory description, uint price) public {
        products[id] = Product(id, name, description, price, RepublicSurpriseStatus.InStock);
    }
}