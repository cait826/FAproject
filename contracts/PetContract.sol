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
    enum ProductStatus {
        Active,
        Inactive
    }

    string public companyName;

    constructor() {
        companyName = "Republic Surprise Shop";
        admin = msg.sender;
    }

    // Product data and sale configuration (individual/set)
    struct Product {
        uint id;
        string name;
        string description;
        uint priceWei;
        ProductStatus status;
        bool enableIndividual;
        bool enableSet;
        uint individualPriceWei;
        uint individualStock;
        uint setPriceWei;
        uint setStock;
        uint setBoxes;
    }

    // Product catalog
    mapping(uint => Product) public products;

    // Product audit record (tracks add/update/status changes)
    struct ProductAudit {
        uint timestamp;
        address actor;
        string action;
    }

    // Product edit log (audit trail)
    mapping(uint => ProductAudit[]) private productAudits;

    event ProductAdded(uint indexed id, string name, uint priceWei, bool enableIndividual, bool enableSet);
    event ProductUpdated(uint indexed id, string name, uint priceWei, bool enableIndividual, bool enableSet);
    event ProductStatusChanged(uint indexed id, ProductStatus status);
    event ProductAuditLogged(uint indexed id, string action, address actor);

    // Add product (admin only)
    function addProduct(
        uint id,
        string memory name,
        string memory description,
        uint priceWei,
        bool enableIndividual,
        bool enableSet,
        uint individualPriceWei,
        uint individualStock,
        uint setPriceWei,
        uint setStock,
        uint setBoxes
    ) public onlyAdmin {
        require(products[id].id == 0, "Product exists");
        _validateBlindBoxConfig(
            enableIndividual,
            enableSet,
            individualPriceWei,
            individualStock,
            setPriceWei,
            setStock,
            setBoxes
        );
        products[id] = Product(
            id,
            name,
            description,
            priceWei,
            ProductStatus.Active,
            enableIndividual,
            enableSet,
            individualPriceWei,
            individualStock,
            setPriceWei,
            setStock,
            setBoxes
        );

        _logProductAudit(id, "ADD_PRODUCT");
        emit ProductAdded(id, name, priceWei, enableIndividual, enableSet);
    }

    // Update product details and sale configuration (admin only)
    function updateProduct(
        uint id,
        string memory name,
        string memory description,
        uint priceWei,
        bool enableIndividual,
        bool enableSet,
        uint individualPriceWei,
        uint individualStock,
        uint setPriceWei,
        uint setStock,
        uint setBoxes
    ) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        _validateBlindBoxConfig(
            enableIndividual,
            enableSet,
            individualPriceWei,
            individualStock,
            setPriceWei,
            setStock,
            setBoxes
        );
        products[id].name = name;
        products[id].description = description;
        products[id].priceWei = priceWei;
        products[id].enableIndividual = enableIndividual;
        products[id].enableSet = enableSet;
        products[id].individualPriceWei = individualPriceWei;
        products[id].individualStock = individualStock;
        products[id].setPriceWei = setPriceWei;
        products[id].setStock = setStock;
        products[id].setBoxes = setBoxes;

        _logProductAudit(id, "UPDATE_PRODUCT");
        emit ProductUpdated(id, name, priceWei, enableIndividual, enableSet);
    }

    // Deactivate product (admin only)
    function deactivateProduct(uint id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Inactive;

        _logProductAudit(id, "DEACTIVATE_PRODUCT");
        emit ProductStatusChanged(id, ProductStatus.Inactive);
    }

    // Reactivate product (admin only)
    function reactivateProduct(uint id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Active;

        _logProductAudit(id, "REACTIVATE_PRODUCT");
        emit ProductStatusChanged(id, ProductStatus.Active);
    }

    // Product edit log count
    function getProductAuditCount(uint id) public view returns (uint) {
        return productAudits[id].length;
    }

    // Product edit log entry
    function getProductAudit(uint id, uint index)
        public
        view
        returns (uint timestamp, address actor, string memory action)
    {
        ProductAudit storage a = productAudits[id][index];
        return (a.timestamp, a.actor, a.action);
    }

    function _logProductAudit(uint id, string memory action) internal {
        productAudits[id].push(ProductAudit(block.timestamp, msg.sender, action));
        emit ProductAuditLogged(id, action, msg.sender);
    }

    function _validateBlindBoxConfig(
        bool enableIndividual,
        bool enableSet,
        uint individualPriceWei,
        uint individualStock,
        uint setPriceWei,
        uint setStock,
        uint setBoxes
    ) internal pure {
        require(enableIndividual || enableSet, "Select at least one purchase type");
        if (enableIndividual) {
            require(individualPriceWei > 0, "Individual price required");
            require(individualStock > 0, "Individual stock required");
        } else {
            require(individualPriceWei == 0, "Individual price must be 0");
            require(individualStock == 0, "Individual stock must be 0");
        }
        if (enableSet) {
            require(setPriceWei > 0, "Set price required");
            require(setStock > 0, "Set stock required");
            require(setBoxes > 0, "Set boxes required");
        } else {
            require(setPriceWei == 0, "Set price must be 0");
            require(setStock == 0, "Set stock must be 0");
            require(setBoxes == 0, "Set boxes must be 0");
        }
    }

    // ---------- Users (on-chain status only) ----------
    struct UserProfile {
        bool exists;
        bool active;
        bytes32 profileHash;
    }

    // User profiles (on-chain status + off-chain profile hash)
    mapping(address => UserProfile) public users;

    event UserRegistered(address indexed user, bytes32 profileHash);
    event UserProfileUpdated(address indexed user, bytes32 profileHash);
    event UserStatusChanged(address indexed user, bool active);

    // User profile: register (admin only)
    function registerUser(address user, bytes32 profileHash) public onlyAdmin {
        require(!users[user].exists, "User exists");
        users[user] = UserProfile(true, true, profileHash);
        emit UserRegistered(user, profileHash);
    }

    // User profile: edit/update (admin only)
    function updateUserProfile(address user, bytes32 profileHash) public onlyAdmin {
        require(users[user].exists, "User not found");
        users[user].profileHash = profileHash;
        emit UserProfileUpdated(user, profileHash);
    }

    // User profile: deactivate (admin only)
    function deactivateUser(address user) public onlyAdmin {
        require(users[user].exists, "User not found");
        users[user].active = false;
        emit UserStatusChanged(user, false);
    }

    // User profile: reactivate (admin only)
    function reactivateUser(address user) public onlyAdmin {
        require(users[user].exists, "User not found");
        users[user].active = true;
        emit UserStatusChanged(user, true);
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
        require(msg.value == products[productId].priceWei, "incorrect amount");

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
