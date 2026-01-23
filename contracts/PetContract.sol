// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RepublicSurpriseContract {
    enum RepublicSurpriseStatus {InStock, OutOfStock}

    string public companyName;

    address public admin;


    // Constructor code is only run when the contract is created
    constructor() {
        companyName = "Republic Surprise Shop";
        admin = msg.sender; //this will set the admin as the contract deployer(also able to approve the refunds)
    }
    //using this modifier to restrict certain functions to only be called by the admin
    modifier onlyAdmin(){
        require(msg.sender == admin, "Only admin can perform this action");
        _;
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
    //this for for the payment part 
    struct Payment {
        address buyer 
        uint amountPaid; //this is the total amount paid by the buyer
        uint refundApproved; //this is the amount approved for refund
        bool refundClaimed; //this indicates if the refund has been claimed or not
    }
    mapping(uint => payment) public payments; //this allow for each order will have its own payment record
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
    //this is for the payment part with the involvemnt of metamask wallet
    function paywithMetamask(uint orderId, uint productId) public payable {
        require(msg.value > 0, "pay > 0"); // this ensure that the payment is must be greater than zero
        require(orders[orderId].orderId == 0, "order exists"); //ensure that there is no duplication of order id 
        require(msg.value == products[productId].price, "incorrect amount"); //ensure that the amount paid is equal to the product price

        //this is to store the payment details
        payments[orderId] = Payment(
            msg.sender,
            msg.value,
            0,
            false
        );
        //this is to create the order after payment
        orders[orderId] = Order(
            orderId,
            "",
            "",
            OrderStatus.Paid
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

    //this is for if the admin approve the partial refund 
    function approvePartialRefund(uint orderId, uint refundAmount) public onlyAdmin {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(refundAmount > 0 && refundAmount < p.amountPaid, "invalid refund");
        require (!p.refundClaimed, "refund claimed");

        p.refundApproved = refundAmount;
    }
    //this is for if the admin approve the full refund
    function approveFullRefund (uint orderId) public onlyAdmin {
        Payment storage p = payments[orderId];
        require (p.amountPaid > 0, "no payment");
        require (!p.refundClaimed, "refund claimed");

        p.refundApproved = p.amountPaid;
    }

    //this is for the buyer to claim the refund only after the admin approve it
    function claimRefund (uint orderId) public {
        Payment storage p = payments[orderId];
        require (p.amountPaid > 0, "no payment");
        require (p.refundApproved > 0, "no refund");
        require (!p.refundClaimed, "refund claimed");
        require (msg.sender == p.buyer, "not buyer");

        uint refundAmount = p.refundApproved;
        p.refundClaimed = true;

        payable (p.buyer).transfer(refundAmount);
    }

}
