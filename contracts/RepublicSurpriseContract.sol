// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;


contract RepublicSurpriseContract {
    // ---------- Roles ----------
    address public owner;
    address public admin; // keep legacy "admin" variable for compatibility
    mapping(address => bool) public admins;
    mapping(address => bool) public deliveryMen;
    mapping(address => Role) public roles;

    enum Role {
        None,
        Buyer,
        Delivery,
        Admin,
        Seller
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender], "admin only");
        _;
    }

    modifier onlyDelivery() {
        require(deliveryMen[msg.sender], "delivery only");
        _;
    }

    modifier onlyDeliveryOrAdmin() {
        require(deliveryMen[msg.sender] || admins[msg.sender], "delivery/admin only");
        _;
    }

    // ---------- Company ----------
    string public companyName;

    constructor() {
        companyName = "Republic Surprise Shop";
        owner = msg.sender;
        admin = msg.sender;

        admins[msg.sender] = true;
        roles[msg.sender] = Role.Seller;
        emit AdminAdded(msg.sender);
    }

    // --- Role management ---
    event AdminAdded(address indexed account);
    event DeliveryAdded(address indexed account);
    event RoleAssigned(address indexed account, Role role, address indexed actor);

    function addAdmin(address account) external onlyOwner {
        admins[account] = true;
        roles[account] = Role.Admin;
        emit AdminAdded(account);
        emit RoleAssigned(account, Role.Admin, msg.sender);
    }

    function addDeliveryMan(address account) external onlyAdmin {
        deliveryMen[account] = true;
        roles[account] = Role.Delivery;
        emit DeliveryAdded(account);
        emit RoleAssigned(account, Role.Delivery, msg.sender);
    }

    function isAdmin(address account) external view returns (bool) {
        return admins[account];
    }

    function isDelivery(address account) external view returns (bool) {
        return deliveryMen[account];
    }

    function assignRole(address account, Role role) external onlyAdmin {
        require(account != address(0), "bad account");

        if (role == Role.Admin) {
            admins[account] = true;
            deliveryMen[account] = false;
        } else if (role == Role.Delivery) {
            deliveryMen[account] = true;
            admins[account] = false;
        } else if (role == Role.Buyer) {
            admins[account] = false;
            deliveryMen[account] = false;
        }

        roles[account] = role;
        emit RoleAssigned(account, role, msg.sender);
    }

    // ---------- Inventory Status (legacy) ----------
    enum RepublicSurpriseStatus {
        InStock,
        OutOfStock
    }

    // ---------- Product ----------
    enum ProductStatus {
        Active,
        Inactive
    }

    struct Product {
        uint256 id;
        string name;
        string description;

        // legacy single price (kept for older cart total logic)
        uint256 priceWei;

        ProductStatus status;

        // blind box sale config
        bool enableIndividual;
        bool enableSet;

        uint256 individualPriceWei;
        uint256 individualStock;

        uint256 setPriceWei;
        uint256 setStock;
        uint256 setBoxes;
    }

    uint256 public productCount;
    uint256 public RepublicSurpriseCount;

    mapping(uint256 => Product) public products;
    mapping(uint256 => RepublicSurpriseStatus) public productInventoryStatus;

    // ---------- Product Audit (events only) ----------
    event ProductAdded(uint256 indexed id, string name, uint256 priceWei, bool enableIndividual, bool enableSet);
    event ProductStatusChanged(uint256 indexed id, ProductStatus status);
    event ProductAuditLogged(uint256 indexed id, string action, address indexed actor, uint256 timestamp, bytes32 dataHash);

    function _logProductAudit(uint256 id, string memory action, bytes32 dataHash) internal {
        emit ProductAuditLogged(id, action, msg.sender, block.timestamp, dataHash);
    }

    function _validateBlindBoxConfig(
        bool enableIndividual,
        bool enableSet,
        uint256 individualPriceWei,
        uint256 individualStock,
        uint256 setPriceWei,
        uint256 setStock,
        uint256 setBoxes
    ) internal pure {
        require(enableIndividual || enableSet, "Select at least one purchase type");

        if (enableIndividual) {
            require(individualPriceWei > 0, "Individual price required");
            // allow stock to be 0 if you want "preorder" style; if not, uncomment:
            // require(individualStock > 0, "Individual stock required");
        } else {
            require(individualPriceWei == 0, "Individual price must be 0");
            require(individualStock == 0, "Individual stock must be 0");
        }

        if (enableSet) {
            require(setPriceWei > 0, "Set price required");
            // allow stock to be 0 if you want; if not, uncomment:
            // require(setStock > 0, "Set stock required");
            require(setBoxes > 0, "Set boxes required");
        } else {
            require(setPriceWei == 0, "Set price must be 0");
            require(setStock == 0, "Set stock must be 0");
            require(setBoxes == 0, "Set boxes must be 0");
        }
    }

    function _updateInventoryStatus(uint256 id) internal {
        Product storage p = products[id];
        bool hasStock =
            (p.enableIndividual && p.individualStock > 0) ||
            (p.enableSet && p.setStock > 0);

        productInventoryStatus[id] = hasStock
            ? RepublicSurpriseStatus.InStock
            : RepublicSurpriseStatus.OutOfStock;
    }

    // Add product 
    function addProduct(
        uint256 id,
        string calldata name,
        string calldata description,
        uint256 priceWei,
        bool enableIndividual,
        bool enableSet,
        uint256 individualPriceWei,
        uint256 individualStock,
        uint256 setPriceWei,
        uint256 setStock,
        uint256 setBoxes
    ) public onlyAdmin {
        require(products[id].id == 0, "Product exists");
        require(bytes(name).length > 0, "name required");

        _validateBlindBoxConfig(
            enableIndividual,
            enableSet,
            individualPriceWei,
            individualStock,
            setPriceWei,
            setStock,
            setBoxes
        );

        products[id] = Product({
            id: id,
            name: name,
            description: description,
            priceWei: priceWei,
            status: ProductStatus.Active,
            enableIndividual: enableIndividual,
            enableSet: enableSet,
            individualPriceWei: individualPriceWei,
            individualStock: individualStock,
            setPriceWei: setPriceWei,
            setStock: setStock,
            setBoxes: setBoxes
        });

        productCount += 1;
        RepublicSurpriseCount = productCount;

        _updateInventoryStatus(id);
        bytes32 dataHash = keccak256(
            abi.encode(id, name, description, priceWei, enableIndividual, enableSet, individualPriceWei, individualStock, setPriceWei, setStock, setBoxes)
        );
        _logProductAudit(id, "ADD_PRODUCT", dataHash);

        emit ProductAdded(id, name, priceWei, enableIndividual, enableSet);
    }

    function deactivateProduct(uint256 id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Inactive;

        _logProductAudit(id, "DEACTIVATE_PRODUCT", keccak256(abi.encode(id, "DEACTIVATE_PRODUCT")));
        emit ProductStatusChanged(id, ProductStatus.Inactive);
    }

    function reactivateProduct(uint256 id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Active;

        _logProductAudit(id, "REACTIVATE_PRODUCT", keccak256(abi.encode(id, "REACTIVATE_PRODUCT")));
        emit ProductStatusChanged(id, ProductStatus.Active);
    }

    // ---------- Users (on-chain status only) ----------
    struct UserProfile {
        bool exists;
        bool active;
        bytes32 profileHash;
    }

    mapping(address => UserProfile) public users;

    event UserRegistered(address indexed user, bytes32 profileHash);
    event UserProfileUpdated(address indexed user, bytes32 profileHash);
    event UserStatusChanged(address indexed user, bool active);
    event UserAuditLogged(address indexed user, string action, address indexed actor, bytes32 profileHash, bool active, uint256 timestamp);

    function registerUser(address user, bytes32 profileHash) public onlyAdmin {
        require(!users[user].exists, "User exists");
        users[user] = UserProfile(true, true, profileHash);
        if (roles[user] == Role.None) {
            roles[user] = Role.Buyer;
            emit RoleAssigned(user, Role.Buyer, msg.sender);
        }
        emit UserRegistered(user, profileHash);
        emit UserAuditLogged(user, "REGISTER", msg.sender, profileHash, true, block.timestamp);
    }

    function updateUserProfile(address user, bytes32 profileHash) public {
        require(msg.sender == user, "user only");
        require(users[user].exists, "User not found");
        users[user].profileHash = profileHash;
        emit UserProfileUpdated(user, profileHash);
        emit UserAuditLogged(user, "UPDATE_PROFILE", msg.sender, profileHash, users[user].active, block.timestamp);
    }

    function deactivateUser(address user) public onlyAdmin {
        require(users[user].exists, "User not found");
        users[user].active = false;
        emit UserStatusChanged(user, false);
        emit UserAuditLogged(user, "DEACTIVATE", msg.sender, users[user].profileHash, false, block.timestamp);
    }

    function reactivateUser(address user) public onlyAdmin {
        require(users[user].exists, "User not found");
        users[user].active = true;
        emit UserStatusChanged(user, true);
        emit UserAuditLogged(user, "REACTIVATE", msg.sender, users[user].profileHash, true, block.timestamp);
    }

    function logProductAudit(uint256 id, string calldata action) external onlyAdmin {
        require(products[id].id != 0, "Product not found");
        _logProductAudit(id, action, keccak256(abi.encode(id, action)));
    }

    function logUserAudit(address user, string calldata action) external onlyAdmin {
        UserProfile storage profile = users[user];
        require(profile.exists, "User not found");
        emit UserAuditLogged(user, action, msg.sender, profile.profileHash, profile.active, block.timestamp);
    }

    // ---------- Cart ---------- (angela)
    // NOTE: to support both individual/set pricing, we store isSet in cart items.
    struct CartItem {
        uint256 productId;
        uint256 quantity;
        bool isSet;
    }

    mapping(address => CartItem[]) private carts;

    event CartItemAdded(address indexed buyer, uint256 productId, uint256 quantity, bool isSet);
    event CartItemRemoved(address indexed buyer, uint256 productId);
    event CartCleared(address indexed buyer);

    function addToCart(uint256 productId, uint256 quantity) external {
        // legacy function: defaults to individual purchase
        addToCartV2(productId, quantity, false);
    }

    function addToCartV2(uint256 productId, uint256 quantity, bool isSet) public {
        require(quantity > 0, "quantity must be > 0");
        require(products[productId].id != 0, "product not found");

        Product memory p = products[productId];
        require(p.status == ProductStatus.Active, "inactive product");
        require(isSet ? p.enableSet : p.enableIndividual, "mode disabled");

        carts[msg.sender].push(CartItem(productId, quantity, isSet));
        emit CartItemAdded(msg.sender, productId, quantity, isSet);
    }

    function removeFromCart(uint256 index) external {
        CartItem[] storage cart = carts[msg.sender];
        require(index < cart.length, "bad index");
        uint256 productId = cart[index].productId;
        cart[index] = cart[cart.length - 1];
        cart.pop();
        emit CartItemRemoved(msg.sender, productId);
    }

    function clearCart() external {
        delete carts[msg.sender];
        emit CartCleared(msg.sender);
    }

    function getCart(address buyer) external view returns (CartItem[] memory) {
        return carts[buyer];
    }

    function getCartTotal(address buyer) public view returns (uint256 total) {
        CartItem[] storage cart = carts[buyer];
        for (uint256 i = 0; i < cart.length; i++) {
            Product memory p = products[cart[i].productId];
            uint256 unit = cart[i].isSet ? p.setPriceWei : p.individualPriceWei;

            // fallback to legacy priceWei if needed
            if (unit == 0) unit = p.priceWei;

            total += unit * cart[i].quantity;
        }
    }

    // ---------- Orders / Delivery (Merged main flow) ----------
    enum OrderStatus {
        Pending,
        Paid,
        OutForDelivery,
        PendingConfirmation,
        Completed,
        Refunded,
        Cancelled
    }

    struct Order {
        uint256 id;
        address buyer;
        uint256 productId;
        bool isSet;
        uint256 qty;
        uint256 paid;       // wei
        OrderStatus status;
        string deliveryId;
        string proofImage;  // base64 hash/URI if needed
    }

    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => address) public orderDeliveryMan;
    mapping(address => uint256[]) private ordersByDeliveryMan;

    struct DeliveryLog {
        OrderStatus status;
        string note;
        string proofImage;
        uint256 timestamp;
        address actor;
    }

    mapping(uint256 => DeliveryLog[]) private deliveryLogs;

    event OrderCreated(
        uint256 indexed orderId,
        uint256 productId,
        address buyer,
        uint256 qty,
        bool isSet,
        uint256 paid
    );

    event DeliveryStatus(
        uint256 indexed orderId,
        string deliveryId,
        OrderStatus status,
        string proofImage
    );

    event OrderStatusChanged(uint256 indexed orderId, OrderStatus status);
    event DeliveryAssigned(uint256 indexed orderId, address indexed deliveryMan, address indexed actor);
    event DeliveryLogAdded(uint256 indexed orderId, OrderStatus status, address indexed actor, string note, string proofImage);

    function _logDelivery(
        uint256 orderId,
        OrderStatus status,
        string memory note,
        string memory proofImage
    ) internal {
        deliveryLogs[orderId].push(
            DeliveryLog({
                status: status,
                note: note,
                proofImage: proofImage,
                timestamp: block.timestamp,
                actor: msg.sender
            })
        );
        emit DeliveryLogAdded(orderId, status, msg.sender, note, proofImage);
    }

    function productPrice(uint256 productId, bool isSet, uint256 qty) external view returns (uint256) {
        Product memory p = products[productId];
        uint256 unit = isSet ? p.setPriceWei : p.individualPriceWei;
        require(unit > 0, "price missing");
        return unit * qty;
    }

    function buy(uint256 productId, bool isSet, uint256 qty, string calldata deliveryId)
        external
        payable
        returns (uint256 orderId)
    {
        require(qty > 0, "qty > 0");

        Product storage p = products[productId];
        require(p.id != 0, "product not found");
        require(p.status == ProductStatus.Active, "inactive product");
        require(isSet ? p.enableSet : p.enableIndividual, "mode disabled");

        if (isSet) {
            require(p.setStock >= qty, "insufficient set stock");
        } else {
            require(p.individualStock >= qty, "insufficient box stock");
        }

        uint256 unit = isSet ? p.setPriceWei : p.individualPriceWei;
        require(unit > 0, "price missing");
        uint256 totalPrice = unit * qty;

        require(msg.value == totalPrice, "wrong payment");

        // debit stock
        if (isSet) p.setStock -= qty;
        else p.individualStock -= qty;

        _updateInventoryStatus(productId);

        orderId = ++orderCount;
        orders[orderId] = Order({
            id: orderId,
            buyer: msg.sender,
            productId: productId,
            isSet: isSet,
            qty: qty,
            paid: msg.value,
            status: OrderStatus.Paid,
            deliveryId: deliveryId,
            proofImage: ""
        });

        emit OrderCreated(orderId, productId, msg.sender, qty, isSet, msg.value);
        _logDelivery(orderId, OrderStatus.Paid, "ORDER_PAID", "");
    }

    function markOutForDelivery(uint256 orderId, string calldata deliveryId) external onlyAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.Paid, "not paid");

        o.status = OrderStatus.OutForDelivery;
        o.deliveryId = deliveryId;

        emit DeliveryStatus(orderId, deliveryId, o.status, "");
        _logDelivery(orderId, o.status, "OUT_FOR_DELIVERY", "");
    }

    // merged signature: allow delivery man OR admin (since old code used onlyAdmin)
    function submitProof(uint256 orderId, string calldata proofImage) external onlyDeliveryOrAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.OutForDelivery, "wrong state");

        o.proofImage = proofImage;
        o.status = OrderStatus.PendingConfirmation;

        emit DeliveryStatus(orderId, o.deliveryId, o.status, proofImage);
        _logDelivery(orderId, o.status, "PROOF_SUBMITTED", proofImage);
    }

    function confirmDelivery(uint256 orderId) external onlyAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.PendingConfirmation, "wrong state");

        o.status = OrderStatus.Completed;
        emit OrderStatusChanged(orderId, o.status);
        _logDelivery(orderId, o.status, "DELIVERY_CONFIRMED", o.proofImage);
    }

    function assignDeliveryManToOrder(uint256 orderId, address deliveryMan) external onlyAdmin {
        require(deliveryMen[deliveryMan], "not delivery");
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");

        orderDeliveryMan[orderId] = deliveryMan;
        ordersByDeliveryMan[deliveryMan].push(orderId);
        emit DeliveryAssigned(orderId, deliveryMan, msg.sender);
    }

    function deliveryAddStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) external onlyDeliveryOrAdmin {
        _setDeliveryStatus(orderId, status, note, proofImage);
    }

    function deliveryUpdateStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) external onlyDeliveryOrAdmin {
        _setDeliveryStatus(orderId, status, note, proofImage);
    }

    function _setDeliveryStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) internal {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");

        if (!admins[msg.sender]) {
            require(
                status == OrderStatus.OutForDelivery ||
                    status == OrderStatus.PendingConfirmation,
                "admin only status"
            );
        }

        o.status = status;
        if (bytes(proofImage).length > 0) {
            o.proofImage = proofImage;
        }

        emit OrderStatusChanged(orderId, status);
        _logDelivery(orderId, status, note, proofImage);
    }

    function getDeliveryHistory(uint256 orderId) external view returns (DeliveryLog[] memory) {
        return deliveryLogs[orderId];
    }

    function getOrderDetail(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getOrdersForDelivery(address deliveryMan) external view returns (uint256[] memory) {
        return ordersByDeliveryMan[deliveryMan];
    }

    // ---------- User Order Tracking (legacy) ---------- (angela)
    enum UserOrderStatus {
        Placed,
        Paid,
        Shipped,
        Delivered,
        Completed,
        Cancelled
    }

    struct UserOrder {
        uint256 id;
        address buyer;
        uint256 totalAmount;
        UserOrderStatus status;
        uint256 createdAt;
    }

    mapping(uint256 => UserOrder) public userOrders;
    mapping(address => uint256[]) public userOrdersByUser;
    uint256 public nextUserOrderId;

    event UserOrderCreated(uint256 indexed orderId, address indexed buyer, uint256 totalAmount);
    event UserOrderStatusUpdated(uint256 indexed orderId, UserOrderStatus status);

    function createUserOrder(uint256 totalAmount) external {
        uint256 id = nextUserOrderId;
        nextUserOrderId += 1;

        userOrders[id] = UserOrder({
            id: id,
            buyer: msg.sender,
            totalAmount: totalAmount,
            status: UserOrderStatus.Placed,
            createdAt: block.timestamp
        });

        userOrdersByUser[msg.sender].push(id);
        emit UserOrderCreated(id, msg.sender, totalAmount);
    }

    function updateUserOrderStatus(uint256 id, UserOrderStatus status) external onlyAdmin {
        UserOrder storage o = userOrders[id];
        require(o.buyer != address(0), "order not found");
        o.status = status;
        emit UserOrderStatusUpdated(id, status);
    }

    // ---------- Refund Tickets ----------
    enum RefundType {
        None,
        Full,
        Partial
    }

    enum RefundStatus {
        Open,
        Approved,
        Rejected,
        Paid
    }

    struct RefundTicket {
        uint256 id;
        uint256 orderId;
        address requester;
        RefundType rType;
        uint256 amount; // wei to refund
        RefundStatus status;
    }

    uint256 public refundCount;
    mapping(uint256 => RefundTicket) public refunds;

    event RefundOpened(uint256 indexed refundId, uint256 indexed orderId, RefundType rType, uint256 amount);
    event RefundApproved(uint256 indexed refundId, uint256 amount);
    event RefundPaid(uint256 indexed refundId, uint256 amount, address to);

    function openRefund(uint256 orderId, RefundType rType, uint256 amount)
        external
        returns (uint256 refundId)
    {
        Order storage o = orders[orderId];
        require(o.buyer == msg.sender, "not buyer");
        require(o.status == OrderStatus.Completed || o.status == OrderStatus.PendingConfirmation, "not eligible");
        require(rType != RefundType.None, "invalid type");
        require(amount > 0 && amount <= o.paid, "bad amount");

        refundId = ++refundCount;
        refunds[refundId] = RefundTicket({
            id: refundId,
            orderId: orderId,
            requester: msg.sender,
            rType: rType,
            amount: amount,
            status: RefundStatus.Open
        });

        emit RefundOpened(refundId, orderId, rType, amount);
    }

    function approveRefund(uint256 refundId) external onlyAdmin {
        RefundTicket storage r = refunds[refundId];
        require(r.id != 0, "refund not found");
        require(r.status == RefundStatus.Open, "not open");
        r.status = RefundStatus.Approved;
        emit RefundApproved(refundId, r.amount);
    }

    function payRefund(uint256 refundId) external onlyAdmin {
        RefundTicket storage r = refunds[refundId];
        require(r.id != 0, "refund not found");
        require(r.status == RefundStatus.Approved, "not approved");

        Order storage o = orders[r.orderId];
        require(o.id != 0, "order not found");

        // update state first
        o.status = OrderStatus.Refunded;
        r.status = RefundStatus.Paid;

        // safer payout
        (bool ok, ) = payable(r.requester).call{value: r.amount}("");
        require(ok, "refund failed");

        emit RefundPaid(refundId, r.amount, r.requester);
    }

    // ---------- Legacy Payment Refund Style (kept) ----------
    struct Payment {
        address buyer;
        uint256 amountPaid;     // wei
        uint256 refundApproved; // wei
        bool refundClaimed;
    }

    mapping(uint256 => Payment) public payments; // orderId -> payment

    event Paid(uint256 orderId, address buyer, uint256 amountPaid);
    event LegacyRefundApproved(uint256 orderId, uint256 refundAmount);
    event RefundClaimed(uint256 orderId, address buyer, uint256 refundAmount);


    function paywithMetamask(uint256 orderId, uint256 productId) public payable {
        require(msg.value > 0, "pay > 0");
        require(orders[orderId].id == 0, "order exists");
        require(products[productId].id != 0, "product not found");

        Product storage p = products[productId];
        require(p.status == ProductStatus.Active, "inactive product");
        require(p.enableIndividual, "individual disabled");
        require(p.individualStock >= 1, "insufficient stock");

        uint256 unit = p.individualPriceWei;
        if (unit == 0) unit = p.priceWei;
        require(unit > 0, "price missing");
        require(msg.value == unit, "incorrect amount");

        // debit 1 box
        p.individualStock -= 1;
        _updateInventoryStatus(productId);

        // store legacy payment record
        payments[orderId] = Payment(msg.sender, msg.value, 0, false);

        // create merged order
        orders[orderId] = Order({
            id: orderId,
            buyer: msg.sender,
            productId: productId,
            isSet: false,
            qty: 1,
            paid: msg.value,
            status: OrderStatus.Paid,
            deliveryId: "",
            proofImage: ""
        });

        // keep orderCount consistent (optional)
        if (orderId > orderCount) orderCount = orderId;

        emit Paid(orderId, msg.sender, msg.value);
        emit OrderCreated(orderId, productId, msg.sender, 1, false, msg.value);
    }

    function approvePartialRefund(uint256 orderId, uint256 refundAmount) public onlyAdmin {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(refundAmount > 0 && refundAmount < p.amountPaid, "invalid refund");
        require(!p.refundClaimed, "refund claimed");

        p.refundApproved = refundAmount;
        emit LegacyRefundApproved(orderId, refundAmount);
    }

    function approveFullRefund(uint256 orderId) public onlyAdmin {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(!p.refundClaimed, "refund claimed");

        p.refundApproved = p.amountPaid;
        emit LegacyRefundApproved(orderId, p.amountPaid);
    }

    function claimRefund(uint256 orderId) public {
        Payment storage p = payments[orderId];
        require(p.amountPaid > 0, "no payment");
        require(p.refundApproved > 0, "no refund");
        require(!p.refundClaimed, "refund claimed");
        require(msg.sender == p.buyer, "not buyer");

        uint256 refundAmount = p.refundApproved;

        // set state first
        p.refundClaimed = true;
        p.refundApproved = 0;

        (bool ok, ) = payable(p.buyer).call{value: refundAmount}("");
        require(ok, "refund failed");

        // also update merged order status if exists
        if (orders[orderId].id != 0) {
            orders[orderId].status = OrderStatus.Refunded;
            emit OrderStatusChanged(orderId, OrderStatus.Refunded);
        }

        emit RefundClaimed(orderId, p.buyer, refundAmount);
    }

    // ---------- Treasury ----------
    function withdraw(address payable to, uint256 amount) external onlyAdmin {
        require(amount <= address(this).balance, "exceeds balance");
        to.transfer(amount);
    }

    // ---------- Safety ----------
    receive() external payable {}
}
