// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RepublicSurpriseContract {
    // ---------- Admin ----------
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }

    // ---------- Product ----------
    enum RepublicSurpriseStatus {
        InStock,
        OutOfStock
    }

    string public companyName;

    constructor() {
        companyName = "Republic Surprise Shop";
        admin = msg.sender;
    }

    struct Product {
        uint id;
        string name;
        string description;
        uint price; // wei
        RepublicSurpriseStatus status;
    }

    mapping(uint => Product) public products;

    function addProduct(
        uint id,
        string memory name,
        string memory description,
        uint price
    ) public onlyAdmin {
        products[id] = Product(id, name, description, price, RepublicSurpriseStatus.InStock);
    }

    // ---------- Payment ----------
    struct Payment {
        address buyer;
        uint amountPaid;     // wei
        uint refundApproved; // wei
        bool refundClaimed;
    }

    mapping(uint => Payment) public payments; // orderId -> payment

    // ---------- Delivery / Order ----------
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
    event DeliveryStatus(uint orderId, string deliveryId, OrderStatus status, string proofImage);
    event OrderCompleted(uint orderId);
    event Paid(uint orderId, address buyer, uint amountPaid);
    event RefundApproved(uint orderId, uint refundAmount);
    event RefundClaimed(uint orderId, address buyer, uint refundAmount);

    // ---------- Pay with MetaMask + create order ----------
    function paywithMetamask(uint orderId, uint productId) public payable {
        require(msg.value > 0, "pay > 0");
        require(orders[orderId].orderId == 0, "order exists");
        require(products[productId].id != 0, "product not found");
        require(msg.value == products[productId].price, "incorrect amount");

        payments[orderId] = Payment(msg.sender, msg.value, 0, false);
        orders[orderId] = Order(orderId, "", "", OrderStatus.Paid);

        emit Paid(orderId, msg.sender, msg.value);
    }

    // ---------- Mark order as out for delivery ----------
    function markOutForDelivery(uint orderId, string memory deliveryId) public onlyAdmin {
        Order storage o = orders[orderId];
        require(o.orderId != 0, "order not found");
        require(o.status == OrderStatus.Paid, "not paid");

        o.deliveryId = deliveryId;
        o.status = OrderStatus.OutForDelivery;

        emit DeliveryStatus(orderId, deliveryId, o.status, "");
    }

    // ---------- Delivery man submits proof ----------
    function submitProof(uint orderId, string memory proofImage) public onlyAdmin {
        Order storage o = orders[orderId];
        require(o.orderId != 0, "order not found");
        require(o.status == OrderStatus.OutForDelivery, "wrong state");

        o.proofImage = proofImage;
        o.status = OrderStatus.PendingConfirmation;

        emit DeliveryStatus(orderId, o.deliveryId, o.status, proofImage);
    }

    // ---------- Admin confirms delivery ----------
    function confirmDelivery(uint orderId) public onlyAdmin {
        Order storage o = orders[orderId];
        require(o.orderId != 0, "order not found");
        require(o.status == OrderStatus.PendingConfirmation, "not ready");

        o.status = OrderStatus.Completed;
        emit OrderCompleted(orderId);
    }

    // ---------- Refunds ----------
    function approvePartialRefund(uint orderId, uint refundAmount) public onlyAdmin {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(refundAmount > 0 && refundAmount < p.amountPaid, "invalid refund");
        require(!p.refundClaimed, "refund claimed");

        p.refundApproved = refundAmount;
        emit RefundApproved(orderId, refundAmount);
    }

    function approveFullRefund(uint orderId) public onlyAdmin {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(!p.refundClaimed, "refund claimed");

        p.refundApproved = p.amountPaid;
        emit RefundApproved(orderId, p.amountPaid);
    }

    function claimRefund(uint orderId) public {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(p.refundApproved > 0, "no refund");
        require(!p.refundClaimed, "refund claimed");
        require(msg.sender == p.buyer, "not buyer");

        uint refundAmount = p.refundApproved;

        // set state first (prevents re-entrancy issues)
        p.refundClaimed = true;
        p.refundApproved = 0;

        // safer than transfer (transfer can fail due to gas changes)
        (bool ok, ) = payable(p.buyer).call{value: refundAmount}("");
        require(ok, "refund failed");

        emit RefundClaimed(orderId, p.buyer, refundAmount);
    }
}
