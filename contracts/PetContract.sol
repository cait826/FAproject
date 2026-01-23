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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RepublicSurpriseContract {

    // ---------- Product ----------
    enum RepublicSurpriseStatus { InStock, OutOfStock }

    string public companyName;

    constructor() {
        companyName = "Republic Surprise Shop";
    }

    struct Product {
        uint id;
        string name;
        string description;
        uint price;
        RepublicSurpriseStatus status;
    }

    mapping(uint => Product) public products;

    function addProduct(
        uint id,
        string memory name,
        string memory description,
        uint price
    ) public {
        products[id] = Product(
            id,
            name,
            description,
            price,
            RepublicSurpriseStatus.InStock
        );
    }

    // ---------- Delivery ----------
    enum OrderStatus {
        Paid,
        OutForDelivery,
        PendingConfirmation,
        Completed
    }

    struct Order {
        uint orderId;
        string deliveryId;
        string proofImage;
        OrderStatus status;
    }

    mapping(uint => Order) public orders;

    // ---------- Events ----------
    event DeliveryStatus(
        uint orderId,
        string deliveryId,
        OrderStatus status,
        string proofImage
    );

    event OrderCompleted(uint orderId);

    // ---------- Create order (after payment) ----------
    function createOrder(uint orderId) public {
        orders[orderId] = Order(
            orderId,
            "",
            "",
            OrderStatus.Paid
        );
    }

    // ---------- Mark order as out for delivery ----------
    function markOutForDelivery(
        uint orderId,
        string memory deliveryId
    ) public {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.Paid, "not paid");

        o.deliveryId = deliveryId;
        o.status = OrderStatus.OutForDelivery;

        emit DeliveryStatus(orderId, deliveryId, o.status, "");
    }

    // ---------- Delivery man submits proof ----------
    function submitProof(
        uint orderId,
        string memory proofImage
    ) public {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.OutForDelivery, "wrong state");

        o.proofImage = proofImage;
        o.status = OrderStatus.PendingConfirmation;

        emit DeliveryStatus(orderId, o.deliveryId, o.status, proofImage);
    }

    // ---------- Admin confirms delivery ----------
    function confirmDelivery(uint orderId) public {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.PendingConfirmation, "not ready");

        o.status = OrderStatus.Completed;

        emit OrderCompleted(orderId);
    }
}
